/**
 * dsh-wps — WPS cloud-doc credential store.
 *
 * Persists the WPS SkillHub access token to ~/.dsh/dsh-wps.json (mode 0600).
 * Secrets never leave this module; the public view() masks everything. The
 * config path can be overridden with DSH_WPS_CONFIG (used by tests).
 */
/** Default machine-wide config location (mode 0600). */
export declare const DEFAULT_CONFIG_FILE: string;
/** Test override for the config location. */
export declare function configPath(): string;
/** The official WPS SkillHub MCP endpoint. */
export declare const MCP_URL = "https://mcp-center.wps.cn/skill_hub/mcp";
/** WPS browser authorization guide URL (login + consent page). */
export declare const AUTH_GUIDE_URL = "https://mcp-center.wps.cn/kdocs-auth/auth-guide";
/** WPS token exchange endpoint (plugin polls it with the auth_code). */
export declare const EXCHANGE_URL = "https://api.wps.cn/office/v5/ai/skill_hub/wps_auth/exchange";
/** Persisted credentials shape. Secrets never leave this module. */
export interface WpsCredentials {
    /** The SkillHub access token (Bearer value). */
    token: string | null;
    /** Seconds until expiry reported by the exchange response (best effort). */
    expiresIn?: number;
    /** ISO timestamp of the last successful token exchange. */
    tokenUpdatedAt: string;
}
/** Public, secret-free status view. */
export interface WpsConfigView {
    configured: boolean;
    authorized: boolean;
    tokenUpdatedAt: string;
    mcpUrl: string;
    authGuideUrl: string;
    configPath: string;
}
/** Mask a credential for display, keeping only the head and tail. */
export declare function mask(value: string): string;
/**
 * Small credential store backed by ~/.dsh/dsh-wps.json.
 * Reads are lazy and cached; writes use mode 0600 so the WPS access token
 * never leaks to other local users.
 */
export declare class WpsStore {
    config: WpsCredentials | null;
    load(): Promise<WpsCredentials>;
    save(next: WpsCredentials): Promise<void>;
    /** Persist a fresh access token. */
    setToken(token: string, expiresIn?: number): Promise<void>;
    /** Clear only the access token. */
    clearToken(): Promise<void>;
    /** Public, secret-free view. */
    view(): Promise<WpsConfigView>;
}
