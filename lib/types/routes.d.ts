/**
 * dsh-wps — loopback HTTP routes for the web settings panel.
 *
 * Route family: /api/dsh-wps/*. All routes are loopback-only (127.0.0.1 /
 * localhost, same-origin). Unlike the OAuth-MCP plugins there is no callback
 * route: WPS authorization runs entirely on the host side (auth_code ->
 * auth-guide -> exchange-poll), so the panel just asks the host to start an
 * authorization and then polls /status until the token lands.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WpsStore } from './store.ts';
import type { WpsSupervisor } from './mcp.ts';
/** Route paths. */
export declare const WPS_API: {
    readonly status: "/api/dsh-wps/status";
    readonly oauthStart: "/api/dsh-wps/oauth/start";
    readonly test: "/api/dsh-wps/test";
    readonly clear: "/api/dsh-wps/clear";
};
/** Route handler context. */
export interface RouteContext {
    store: WpsStore;
    supervisor: WpsSupervisor;
}
/**
 * Build every /api/dsh-wps route (exact paths).
 * @param deps - store and MCP supervisor.
 * @returns the route list.
 */
export declare function makeRoutes(deps: RouteContext): ({
    kind: "exact";
    path: "/api/dsh-wps/status";
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
} | {
    kind: "exact";
    path: "/api/dsh-wps/oauth/start";
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
} | {
    kind: "exact";
    path: "/api/dsh-wps/test";
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
} | {
    kind: "exact";
    path: "/api/dsh-wps/clear";
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
})[];
