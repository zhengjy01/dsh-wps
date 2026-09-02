/**
 * dsh-wps — WPS cloud-doc credential store.
 *
 * Persists the WPS SkillHub access token to ~/.dsh/dsh-wps.json (mode 0600).
 * Secrets never leave this module; the public view() masks everything. The
 * config path can be overridden with DSH_WPS_CONFIG (used by tests).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

/** Default machine-wide config location (mode 0600). */
export const DEFAULT_CONFIG_FILE = path.join(homedir(), '.dsh', 'dsh-wps.json')

/** Test override for the config location. */
export function configPath(): string {
  const override = process.env.DSH_WPS_CONFIG
  return override !== undefined && override !== '' ? override : DEFAULT_CONFIG_FILE
}

/** The official WPS SkillHub MCP endpoint. */
export const MCP_URL = 'https://mcp-center.wps.cn/skill_hub/mcp'

/** WPS browser authorization guide URL (login + consent page). */
export const AUTH_GUIDE_URL = 'https://mcp-center.wps.cn/kdocs-auth/auth-guide'

/** WPS token exchange endpoint (plugin polls it with the auth_code). */
export const EXCHANGE_URL = 'https://api.wps.cn/office/v5/ai/skill_hub/wps_auth/exchange'

/** Persisted credentials shape. Secrets never leave this module. */
export interface WpsCredentials {
  /** The SkillHub access token (Bearer value). */
  token: string | null
  /** Seconds until expiry reported by the exchange response (best effort). */
  expiresIn?: number
  /** ISO timestamp of the last successful token exchange. */
  tokenUpdatedAt: string
}

/** Public, secret-free status view. */
export interface WpsConfigView {
  configured: boolean
  authorized: boolean
  tokenUpdatedAt: string
  mcpUrl: string
  authGuideUrl: string
  configPath: string
}

/** Mask a credential for display, keeping only the head and tail. */
export function mask(value: string): string {
  if (!value) return ''
  if (value.length <= 8) return value.slice(0, 2) + '****'
  return value.slice(0, 4) + '****' + value.slice(-4)
}

/** Empty credentials record. */
function empty(): WpsCredentials {
  return { token: null, tokenUpdatedAt: '' }
}

/** Parse an unknown JSON record into credentials (tolerates missing keys). */
function parse(raw: unknown): WpsCredentials {
  const record = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  const str = (value: unknown): string => (typeof value === 'string' ? value : '')
  return {
    token: str(record.token) !== '' ? str(record.token) : null,
    expiresIn: typeof record.expiresIn === 'number' ? record.expiresIn : undefined,
    tokenUpdatedAt: str(record.tokenUpdatedAt),
  }
}

/**
 * Small credential store backed by ~/.dsh/dsh-wps.json.
 * Reads are lazy and cached; writes use mode 0600 so the WPS access token
 * never leaks to other local users.
 */
export class WpsStore {
  config: WpsCredentials | null = null

  async load(): Promise<WpsCredentials> {
    if (this.config !== null) return this.config
    try {
      const raw = await readFile(configPath(), 'utf8')
      this.config = parse(JSON.parse(raw))
    } catch {
      // Missing or unreadable config file: treat as unconfigured.
      this.config = empty()
    }
    return this.config
  }

  async save(next: WpsCredentials): Promise<void> {
    this.config = next
    await mkdir(path.dirname(configPath()), { recursive: true })
    await writeFile(configPath(), JSON.stringify(next, null, 2), { mode: 0o600 })
  }

  /** Persist a fresh access token. */
  async setToken(token: string, expiresIn?: number): Promise<void> {
    await this.save({
      token,
      expiresIn: typeof expiresIn === 'number' ? expiresIn : undefined,
      tokenUpdatedAt: new Date().toISOString(),
    })
  }

  /** Clear only the access token. */
  async clearToken(): Promise<void> {
    const cfg = await this.load()
    cfg.token = null
    cfg.tokenUpdatedAt = ''
    await this.save(cfg)
  }

  /** Public, secret-free view. */
  async view(): Promise<WpsConfigView> {
    const cfg = await this.load()
    return {
      configured: cfg.token !== null,
      authorized: cfg.token !== null && cfg.token.trim() !== '',
      tokenUpdatedAt: cfg.tokenUpdatedAt,
      mcpUrl: MCP_URL,
      authGuideUrl: AUTH_GUIDE_URL,
      configPath: configPath(),
    }
  }
}
