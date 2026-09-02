/**
 * dsh-wps — loopback HTTP routes for the web settings panel.
 *
 * Route family: /api/dsh-wps/*. All routes are loopback-only (127.0.0.1 /
 * localhost, same-origin). Unlike the OAuth-MCP plugins there is no callback
 * route: WPS authorization runs entirely on the host side (auth_code ->
 * auth-guide -> exchange-poll), so the panel just asks the host to start an
 * authorization and then polls /status until the token lands.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WpsStore } from './store.ts'
import type { WpsSupervisor } from './mcp.ts'
import { authorize } from './auth.ts'

/** Route paths. */
export const WPS_API = {
  status: '/api/dsh-wps/status',
  oauthStart: '/api/dsh-wps/oauth/start',
  test: '/api/dsh-wps/test',
  clear: '/api/dsh-wps/clear',
} as const

/** Cap on JSON request bodies. */
const MAX_JSON_BODY_BYTES = 64 * 1024

/** Guard against two concurrent background authorizations. */
let authPromise: Promise<void> | null = null

/** Strict loopback fence. */
function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** One JSON response. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(payload)
}

/** Route handler context. */
export interface RouteContext {
  store: WpsStore
  supervisor: WpsSupervisor
}

/**
 * Build every /api/dsh-wps route (exact paths).
 * @param deps - store and MCP supervisor.
 * @returns the route list.
 */
export function makeRoutes(deps: RouteContext) {
  const { store, supervisor } = deps

  const guard = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { error: 'forbidden: loopback-only' })
      return false
    }
    if (req.method !== method) {
      writeJson(res, 405, { error: `method not allowed: ${req.method}` })
      return false
    }
    return true
  }

  const statusView = async (): Promise<Record<string, unknown>> => {
    const view = await store.view()
    return {
      ...view,
      connected: supervisor.isConnected(),
      toolCount: supervisor.toolCount(),
    }
  }

  return [
    {
      kind: 'exact' as const,
      path: WPS_API.status,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'GET')) return
        writeJson(res, 200, await statusView())
      },
    },
    {
      kind: 'exact' as const,
      path: WPS_API.oauthStart,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        const view = await store.view()
        if (view.authorized) {
          writeJson(res, 200, { ok: true, message: '已授权。', view: await statusView() })
          return
        }
        if (authPromise !== null) {
          writeJson(res, 200, { ok: true, message: '授权已在后台进行中，请在浏览器完成登录。', started: true, view: await statusView() })
          return
        }
        // Kick off host-side authorization (opens the browser + polls exchange).
        authPromise = (async () => {
          await authorize(store)
          await supervisor.ensureConnected()
        })().catch((error) => {
          console.error('[dsh-wps] authorization failed:', error instanceof Error ? error.message : error)
        }).finally(() => {
          authPromise = null
        })
        writeJson(res, 200, { ok: true, message: '已在浏览器打开 WPS 登录页，请登录并授权。', started: true, view: await statusView() })
      },
    },
    {
      kind: 'exact' as const,
      path: WPS_API.test,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        const view = await store.view()
        if (!view.authorized) {
          writeJson(res, 200, { ok: false, error: '尚未授权：请先点击「开始授权」。', view: await statusView() })
          return
        }
        try {
          await supervisor.ensureConnected()
          const tools = await supervisor.listTools()
          writeJson(res, 200, { ok: true, message: `连接成功，发现 ${tools.length} 个 WPS SkillHub MCP 工具。`, tools, view: await statusView() })
        } catch (error) {
          writeJson(res, 200, { ok: false, error: String(error instanceof Error ? error.message : error), view: await statusView() })
        }
      },
    },
    {
      kind: 'exact' as const,
      path: WPS_API.clear,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        await supervisor.dispose()
        await store.clearToken()
        writeJson(res, 200, { ok: true, message: '已清除 WPS 授权并断开连接。', view: await statusView() })
      },
    },
  ]
}
