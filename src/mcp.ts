/**
 * dsh-wps — WPS SkillHub MCP connection (custom JSON-RPC-over-HTTP client).
 *
 * WPS's cloud-doc MCP has no standard OAuth discovery, so we talk to
 * https://mcp-center.wps.cn/skill_hub/mcp directly over JSON-RPC 2.0, using
 * the BrowserAuth access token as the Bearer credential on every request:
 *
 *   initialize (protocolVersion 2024-11-05) -> notifications/initialized
 *       -> tools/list (paged) -> register mcp__wps__<rawName>
 *       -> tools/call (per registered tool)
 *
 * The server's business results are wrapped in an MCP content envelope:
 * { jsonrpc, id, result: { content: [{ type: 'text', text: '{"code":0,...}' }] } }
 * — we surface the text blocks verbatim (the agent parses the nested JSON).
 */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { WpsStore, MCP_URL } from './store.ts'
import { ensureAuthenticated, WPS_CLIENT_NAME, WPS_SKILL_VERSION } from './auth.ts'

/** DeepSeek function-name contract: at most 64 characters. */
const MAX_PUBLIC_NAME_LENGTH = 64
/** DeepSeek function-name contract: only `[A-Za-z0-9_-]` is allowed. */
const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g
/** Hex chars of the SHA-256 identity hash appended on lossy normalization. */
const HASH_LENGTH = 12
/** Default per-request timeout (ms). */
const REQUEST_TIMEOUT_MS = 60_000

/** MCP protocol version we announce. */
const PROTOCOL_VERSION = '2024-11-05'

/** A discovered WPS MCP tool definition. */
interface WpsToolDefinition {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

/** Live connection state (token + session id). */
interface Connection {
  token: string
  sessionId: string | null
}

/** A JSON-RPC round-trip: result plus the session id the server echoed. */
interface RpcReply {
  result: unknown
  sessionId: string | null
}

/**
 * Derive the model-facing public name (mcp__wps__<rawName>).
 *
 * WPS's server tool names use dots as namespace separators (e.g.
 * `sheet.get_range_data`). Dots are not valid in a DeepSeek function name, so
 * they map deterministically to underscores; because every WPS tool is dotted,
 * we do NOT append a hash for dot-only normalization — that would make every
 * public name unreadable. We only fall back to the lossy hashed form when a
 * name contains genuinely invalid characters beyond dots (spaces, slashes,
 * colons, ...) or exceeds the 64-char ceiling.
 */
export function publicToolName(rawName: string): string {
  const joined = `mcp__wps__${rawName}`
  const normalized = joined.replace(INVALID_NAME_CHARS, '_')
  // Dot-only normalization (plus the standard hyphen/underscore) is readable and
  // collision-safe enough for the WPS namespace; hash only for real overflows.
  const nonDotInvalid = /[^A-Za-z0-9_.-]/.test(joined)
  if (!nonDotInvalid && normalized.length <= MAX_PUBLIC_NAME_LENGTH) return normalized
  const hash = createHash('sha256').update(`wps\0${rawName}`).digest('hex').slice(0, HASH_LENGTH)
  return `${normalized.slice(0, MAX_PUBLIC_NAME_LENGTH - HASH_LENGTH - 1)}_${hash}`
}

/** Extract readable text from an MCP content array. */
function extractText(mcpContent: unknown, toolName: string): string {
  if (!Array.isArray(mcpContent)) return `(${toolName} returned non-content output)`
  const parts: string[] = []
  for (const value of mcpContent) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const block = value as Record<string, unknown>
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n') || `(${toolName} returned no text content)`
}

/** Supervisor handle consumed by the host plugin and helper tools. */
export interface WpsSupervisor {
  isConnected(): boolean
  toolCount(): number
  listTools(): Promise<string[]>
  /** Connect (authorize if needed) and register mcp__wps__* tools. Throws on failure. */
  ensureConnected(): Promise<void>
  /** Execute one WPS MCP tool by its raw server name. */
  callTool(rawName: string, args: Record<string, unknown>): Promise<{ content: unknown }>
  dispose(): Promise<void>
}

/**
 * Create the WPS MCP supervisor.
 * @param ctx - cordis context carrying the tools registry and logger.
 * @param store - credential store.
 */
export function createSupervisor(ctx: Context, store: WpsStore): WpsSupervisor {
  let conn: Connection | null = null
  let disposers = new Map<string, () => void>()
  let disposed = false

  /** Send one JSON-RPC request and return the result plus the echoed session id. */
  async function rpc(
    method: string,
    params: unknown,
    token: string,
    sessionId: string | null,
    isNotification: boolean,
  ): Promise<RpcReply> {
    const body: Record<string, unknown> = { jsonrpc: '2.0', method }
    if (!isNotification) body.id = 1
    if (params !== undefined && !isNotification) body.params = params
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-Skill-Version': WPS_SKILL_VERSION,
      'X-Request-Source': WPS_CLIENT_NAME,
      'User-Agent': `${WPS_CLIENT_NAME}/${WPS_SKILL_VERSION}`,
    }
    if (sessionId) headers['Mcp-Session-Id'] = sessionId
    const response = await fetch(MCP_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    // Capture (or refresh) the session id the server returns.
    const nextSessionId = response.headers.get('mcp-session-id') ?? response.headers.get('Mcp-Session-Id')
    if (isNotification) return { result: undefined, sessionId: nextSessionId }
    const rawText = await response.text()
    let json: any
    try {
      json = JSON.parse(rawText)
    } catch {
      // Non-JSON error body (e.g. an HTML/plain error page), keep it readable.
      throw new Error(`WPS MCP ${method} 失败 (HTTP ${response.status}): ${rawText.slice(0, 240)}`)
    }
    if (json.error) {
      throw new Error(`WPS MCP ${method} 失败: ${json.error?.message ?? JSON.stringify(json.error)}`)
    }
    return { result: json.result ?? json, sessionId: nextSessionId }
  }

  /** Open a fresh session (initialize + initialized notification). */
  async function openSession(token: string): Promise<Connection> {
    let sessionId: string | null = null
    const initReply = await rpc('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: WPS_CLIENT_NAME, version: WPS_SKILL_VERSION },
    }, token, null, false)
    sessionId = initReply.sessionId
    const notifReply = await rpc('notifications/initialized', undefined, token, sessionId, true)
    sessionId = notifReply.sessionId ?? sessionId
    return { token, sessionId }
  }

  /** List all tools from the server (paged). */
  async function listTools(token: string, sessionId: string | null): Promise<WpsToolDefinition[]> {
    const tools: WpsToolDefinition[] = []
    let cursor: string | null = null
    do {
      const reply = await rpc('tools/list', cursor === null ? {} : { cursor }, token, sessionId, false)
      const result = reply.result as { tools?: Array<Record<string, unknown>>; nextCursor?: string | null } | undefined
      for (const tool of result?.tools ?? []) {
        tools.push({
          name: String(tool.name ?? ''),
          description: typeof tool.description === 'string' ? tool.description : '',
          inputSchema: (tool.inputSchema ?? {}) as Record<string, unknown>,
        })
      }
      cursor = result?.nextCursor ?? null
    } while (typeof cursor === 'string' && cursor !== '')
    return tools
  }

  /** Register mcp__wps__* tools from a tool list, replacing prior registrations. */
  async function syncTools(activeConn: Connection): Promise<void> {
    const tools = await listTools(activeConn.token, activeConn.sessionId)
    for (const dispose of disposers.values()) dispose()
    disposers = new Map()
    for (const tool of tools) {
      disposers.set(publicToolName(tool.name), ctx.tools.register({
        name: publicToolName(tool.name),
        description: tool.description ?? '',
        parameters: tool.inputSchema ?? {},
        output: {
          schema: {
            type: 'object',
            properties: { content: { type: 'array', items: {} } },
            required: ['content'],
            additionalProperties: false,
          },
          render(_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> {
            const content = typeof value === 'object' && value !== null
              ? (value as Record<string, unknown>).content
              : undefined
            return [{ type: 'text', text: extractText(content, tool.name) }]
          },
        },
        execute: async (args: unknown): Promise<unknown> => {
          const cleanArgs = typeof args === 'object' && args !== null ? args as Record<string, unknown> : {}
          const reply = await rpc('tools/call', { name: tool.name, arguments: cleanArgs }, activeConn.token, activeConn.sessionId, false)
          return { content: (reply.result as { content?: unknown } | undefined)?.content ?? [] }
        },
      }))
    }
  }

  /** The public supervisor. */
  return {
    isConnected(): boolean { return conn !== null },
    toolCount(): number { return disposers.size },
    async listTools(): Promise<string[]> {
      await this.ensureConnected()
      return (await listTools(conn!.token, conn!.sessionId)).map((t) => t.name)
    },
    async ensureConnected(): Promise<void> {
      if (disposed) throw new Error('dsh-wps 已卸载')
      if (conn !== null) return
      const token = await ensureAuthenticated(store)
      conn = await openSession(token)
      await syncTools(conn)
    },
    async callTool(rawName: string, args: Record<string, unknown>): Promise<{ content: unknown }> {
      await this.ensureConnected()
      const reply = await rpc('tools/call', { name: rawName, arguments: args }, conn!.token, conn!.sessionId, false)
      return { content: (reply.result as { content?: unknown } | undefined)?.content ?? [] }
    },
    async dispose(): Promise<void> {
      disposed = true
      conn = null
      for (const dispose of disposers.values()) dispose()
      disposers = new Map()
    },
  }
}
