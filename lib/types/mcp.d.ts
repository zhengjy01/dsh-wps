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
import type { Context } from '@deepseek-ai/cordis';
import { WpsStore } from './store.ts';
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
export declare function publicToolName(rawName: string): string;
/** Supervisor handle consumed by the host plugin and helper tools. */
export interface WpsSupervisor {
    isConnected(): boolean;
    toolCount(): number;
    listTools(): Promise<string[]>;
    /** Connect (authorize if needed) and register mcp__wps__* tools. Throws on failure. */
    ensureConnected(): Promise<void>;
    /** Execute one WPS MCP tool by its raw server name. */
    callTool(rawName: string, args: Record<string, unknown>): Promise<{
        content: unknown;
    }>;
    dispose(): Promise<void>;
}
/**
 * Create the WPS MCP supervisor.
 * @param ctx - cordis context carrying the tools registry and logger.
 * @param store - credential store.
 */
export declare function createSupervisor(ctx: Context, store: WpsStore): WpsSupervisor;
