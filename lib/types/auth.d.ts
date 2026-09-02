/**
 * dsh-wps — WPS SkillHub browser authorization.
 *
 * The official WPS cloud-doc MCP uses a custom, non-standard auth flow (no
 * MCP OAuth discovery — the well-known endpoint 404s):
 *
 *   1. Generate a random `auth_code` and open the browser to
 *      `https://mcp-center.wps.cn/kdocs-auth/auth-guide?auth_code=<uuid>`.
 *   2. The user logs into WPS and consents; the server marks that auth_code
 *      as authorized.
 *   3. The plugin POLLS the exchange endpoint
 *      `https://api.wps.cn/office/v5/ai/skill_hub/wps_auth/exchange` with the
 *      same auth_code every second until the server returns an access token
 *      (or times out). No loopback callback server is required.
 *
 * The returned token is then used as the `Authorization: Bearer <token>` on
 * every MCP request to https://mcp-center.wps.cn/skill_hub/mcp.
 */
import { WpsStore } from './store.ts';
/** Maximum wait for the user to complete browser authorization (5 minutes). */
export declare const AUTH_TIMEOUT_MS: number;
/** How often to poll the exchange endpoint (1 second). */
export declare const POLL_INTERVAL_MS = 1000;
/** Client identity reported to WPS. */
export declare const WPS_CLIENT_NAME = "dsh-wps";
/** Skill version reported to WPS. */
export declare const WPS_SKILL_VERSION = "1.0.0";
/** Result of the token polling loop. */
export interface PollOutcome {
    token: string;
    expiresIn?: number;
}
/**
 * Open the OS browser for a URL without an extra npm dependency.
 */
export declare function openBrowser(url: string): void;
/**
 * Poll the WPS exchange endpoint until the auth_code yields a token.
 * @param authCode - the browser-flow auth_code.
 * @param timeoutMs - overall deadline.
 * @returns the token (and optional expiry seconds).
 * @throws on timeout or a fatal exchange error (403 enterprise reject / 409 cancelled).
 */
export declare function pollToken(authCode: string, timeoutMs?: number): Promise<PollOutcome>;
/**
 * Trigger the browser authorization flow and return the access token,
 * persisting it to the store.
 */
export declare function authorize(store: WpsStore): Promise<string>;
/** Ensure a token exists: return the stored one or trigger authorization. */
export declare function ensureAuthenticated(store: WpsStore): Promise<string>;
