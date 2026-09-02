/**
 * dsh-wps — WPS / 金山文档 cloud-docs integration for DeepSeek Harness.
 *
 * Host half only. Connects to the official WPS SkillHub MCP
 * (https://mcp-center.wps.cn/skill_hub/mcp) through a custom browser
 * authorization (auth-guide + exchange-poll token, see src/auth.ts), registers
 * the server's tools under mcp__wps__<rawName> once authorized, and exposes a
 * small set of agent-facing helper tools (wps_status / wps_oauth_start /
 * wps_test / wps_clear). The access token lives in ~/.dsh/dsh-wps.json
 * (mode 0600). Everything rides the official npm peer packages — no dsh source
 * changes.
 */
import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { WpsStore } from './store.ts';
import { type WpsSupervisor } from './mcp.ts';
/** Stable cordis plugin name. */
export declare const name = "wps";
/** Services required before the surfaces can mount. */
export declare const inject: string[];
/** Model-facing announcement: plugin presence, capabilities, and limits. */
export declare const WPS_GUIDANCE: string;
/** Plugin config, read from the composition row. */
export interface Config {
    announceToAgent?: boolean;
    enabled?: boolean;
}
/** Shared tool dependencies. */
export interface ToolContext {
    store: WpsStore;
    supervisor: WpsSupervisor;
}
/**
 * Mount the WPS helper tools, routes, and announcement.
 * @param ctx - host plugin context carrying tools/systemPrompt.
 * @param config - plugin config from the composition row.
 */
export declare function apply(ctx: Context, config?: Config): void;
/** Re-exports for host consumers and the smoke tests. */
export { WpsStore, mask, configPath, MCP_URL, AUTH_GUIDE_URL, EXCHANGE_URL, type WpsConfigView, type WpsCredentials } from './store.ts';
export { createSupervisor, publicToolName, type WpsSupervisor } from './mcp.ts';
export { authorize, ensureAuthenticated, openBrowser, pollToken } from './auth.ts';
export { makeRoutes, WPS_API } from './routes.ts';
export { defineTool };
