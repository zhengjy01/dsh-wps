/**
 * Browser-side API client for the /api/dsh-wps route family. The only data
 * access path the settings panel uses — plain fetch, same origin.
 */

/** Public status view (mirrors the host contract). */
export interface WpsStatusView {
  configured: boolean
  authorized: boolean
  tokenUpdatedAt: string
  mcpUrl: string
  authGuideUrl: string
  configPath: string
  connected: boolean
  toolCount: number
}

/** Error carrying the route's JSON error message. */
export class WpsApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WpsApiError'
  }
}

/** Parse a JSON response or throw a WpsApiError. */
async function readJson<T>(response: Response): Promise<T> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new WpsApiError(`HTTP ${response.status}: invalid JSON response`)
  }
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `HTTP ${response.status}`
    throw new WpsApiError(message)
  }
  return body as T
}

/** Plain fetch helper with an error wrapper. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch (error) {
    throw new WpsApiError('网络请求失败: ' + String(error instanceof Error ? error.message : error))
  }
  return readJson<T>(response)
}

/** The WPS panel API. */
export class WpsApi {
  async status(): Promise<WpsStatusView> {
    return request<WpsStatusView>('/api/dsh-wps/status')
  }

  async oauthStart(): Promise<{ ok: boolean; message: string; started?: boolean; error?: string; view: WpsStatusView }> {
    return request('/api/dsh-wps/oauth/start', { method: 'POST' })
  }

  async test(): Promise<{ ok: boolean; message?: string; error?: string; tools?: string[]; view: WpsStatusView }> {
    return request('/api/dsh-wps/test', { method: 'POST' })
  }

  async clear(): Promise<{ ok: boolean; message: string; view: WpsStatusView }> {
    return request('/api/dsh-wps/clear', { method: 'POST' })
  }
}
