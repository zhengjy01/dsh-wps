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

import { randomUUID } from 'node:crypto'
import { execSync } from 'node:child_process'
import {
  WpsStore,
  AUTH_GUIDE_URL,
  EXCHANGE_URL,
} from './store.ts'

/** Maximum wait for the user to complete browser authorization (5 minutes). */
export const AUTH_TIMEOUT_MS = 5 * 60 * 1000
/** How often to poll the exchange endpoint (1 second). */
export const POLL_INTERVAL_MS = 1_000
/** Client identity reported to WPS. */
export const WPS_CLIENT_NAME = 'dsh-wps'
/** Skill version reported to WPS. */
export const WPS_SKILL_VERSION = '1.0.0'

/** Result of the token polling loop. */
export interface PollOutcome {
  token: string
  expiresIn?: number
}

/**
 * Open the OS browser for a URL without an extra npm dependency.
 */
export function openBrowser(url: string): void {
  const platform = process.platform
  let command: string
  let args: string[]
  switch (platform) {
    case 'win32':
      command = 'rundll32'
      args = ['url.dll,FileProtocolHandler', url]
      break
    case 'darwin':
      command = 'open'
      args = [url]
      break
    default:
      command = 'xdg-open'
      args = [url]
      break
  }
  execSync(`${command} ${args.map((a) => `"${a}"`).join(' ')}`, { stdio: 'ignore' })
}

/**
 * Poll the WPS exchange endpoint until the auth_code yields a token.
 * @param authCode - the browser-flow auth_code.
 * @param timeoutMs - overall deadline.
 * @returns the token (and optional expiry seconds).
 * @throws on timeout or a fatal exchange error (403 enterprise reject / 409 cancelled).
 */
export async function pollToken(authCode: string, timeoutMs = AUTH_TIMEOUT_MS): Promise<PollOutcome> {
  const deadline = Date.now() + timeoutMs
  const body = JSON.stringify({ code: authCode })
  let pollCount = 0

  while (Date.now() < deadline) {
    pollCount += 1
    try {
      const response = await fetch(EXCHANGE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': `${WPS_CLIENT_NAME}/${WPS_SKILL_VERSION}`,
        },
        body,
        signal: AbortSignal.timeout(15_000),
      })

      if (!response.ok) {
        // Still likely waiting for the user; keep polling but back off slightly.
        await sleep(POLL_INTERVAL_MS)
        continue
      }

      const data = (await response.json()) as Record<string, unknown>
      const nested = (typeof data.data === 'object' && data.data !== null ? data.data as Record<string, unknown> : {})
      const code = data.code ?? nested.code
      const token = (data.token ?? nested.token) as string | undefined
      const expiresIn = (data.expires_in ?? nested.expires_in) as number | undefined

      if (Number(code) === 200 && token) {
        return { token, expiresIn: typeof expiresIn === 'number' ? expiresIn : undefined }
      }
      if (Number(code) === 403) {
        throw new Error('企业账号授权被拒绝，请使用个人 WPS 账号重新授权')
      }
      if (Number(code) === 409) {
        throw new Error('本次授权已取消，请重新授权')
      }
      // Otherwise keep polling for the user to finish logging in.
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('企业') || error instanceof Error && error.message.startsWith('本次')) {
        throw error
      }
      // Network or protocol error during a poll: keep polling for the deadline.
    }
    await sleep(POLL_INTERVAL_MS)
  }

  throw new Error('授权超时（5 分钟），请重新触发授权')
}

/**
 * Trigger the browser authorization flow and return the access token,
 * persisting it to the store.
 */
export async function authorize(store: WpsStore): Promise<string> {
  const authCode = randomUUID()
  const authUrl = `${AUTH_GUIDE_URL}?auth_code=${authCode}`
  // Open the browser so the user can log in and consent.
  openBrowser(authUrl)
  const { token, expiresIn } = await pollToken(authCode)
  await store.setToken(token, expiresIn)
  return token
}

/** Ensure a token exists: return the stored one or trigger authorization. */
export async function ensureAuthenticated(store: WpsStore): Promise<string> {
  const cfg = await store.load()
  if (cfg.token && cfg.token.trim() !== '') return cfg.token
  return authorize(store)
}

/** Small sleep helper. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
