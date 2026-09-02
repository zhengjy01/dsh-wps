/**
 * Browser-side API client for the /api/dsh-wps route family. The only data
 * access path the settings panel uses — plain fetch, same origin.
 */
/** Public status view (mirrors the host contract). */
export interface WpsStatusView {
    configured: boolean;
    authorized: boolean;
    tokenUpdatedAt: string;
    mcpUrl: string;
    authGuideUrl: string;
    configPath: string;
    connected: boolean;
    toolCount: number;
}
/** Error carrying the route's JSON error message. */
export declare class WpsApiError extends Error {
    constructor(message: string);
}
/** The WPS panel API. */
export declare class WpsApi {
    status(): Promise<WpsStatusView>;
    oauthStart(): Promise<{
        ok: boolean;
        message: string;
        started?: boolean;
        error?: string;
        view: WpsStatusView;
    }>;
    test(): Promise<{
        ok: boolean;
        message?: string;
        error?: string;
        tools?: string[];
        view: WpsStatusView;
    }>;
    clear(): Promise<{
        ok: boolean;
        message: string;
        view: WpsStatusView;
    }>;
}
