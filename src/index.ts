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

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { WpsStore, type WpsConfigView } from './store.ts'
import { createSupervisor, type WpsSupervisor } from './mcp.ts'
import { makeRoutes, WPS_API } from './routes.ts'

/** Stable cordis plugin name. */
export const name = 'wps'

/** Services required before the surfaces can mount. */
export const inject = ['tools', 'systemPrompt', 'webServer']

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 165

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const WPS_GUIDANCE =
  '本机已安装 dsh-wps 插件（WPS / 金山文档云文档）：通过浏览器授权后，' +
  '金山文档官方 SkillHub MCP 的工具以 mcp__wps__* 形式可用，' +
  '覆盖云盘管理（列目录/搜索/读取/创建/上传/下载云文档、文件详情与分享）与文档内容操作' +
  '（文字/表格/演示/PDF 的读写与导出，如 wps.read_text、sheet.get_range_data、wpp.read_slide 等）。' +
  '授权流程：wps_oauth_start 触发浏览器授权（打开 WPS 登录页并登录，自动轮询取 token）→ 成功后可调用 mcp__wps__*。' +
  'wps_status 查看连接状态（不回显令牌），wps_test 测试连接并列出工具。' +
  '令牌存 ~/.dsh/dsh-wps.json（权限 0600）。' +
  '用户提到「WPS / 金山文档 / 云文档 / 查云文档」时即指本插件，请据此协作。'

/** Plugin config, read from the composition row. */
export interface Config {
  announceToAgent?: boolean
  enabled?: boolean
}

/** Shared tool dependencies. */
export interface ToolContext {
  store: WpsStore
  supervisor: WpsSupervisor
}

/** Build every agent-facing wps_* tool. */
function buildTools(ctx: ToolContext): ReturnType<typeof defineTool>[] {
  return [
    wpsStatusTool(ctx),
    wpsOauthStartTool(ctx),
    wpsTestTool(ctx),
    wpsClearTool(ctx),
  ]
}

/** One text content block. */
function text(value: string): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: value }]
}

/** Status tool: auth state, connection state, tool count. */
function wpsStatusTool(ctx: ToolContext) {
  return defineTool({
    name: 'wps_status',
    description:
      '查看 dsh-wps 插件状态：是否已授权、令牌最近更新时间、MCP 是否已连接、已注册的 WPS 工具数量。不会泄露任何密钥。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          authorized: { type: 'boolean' },
          connected: { type: 'boolean' },
          toolCount: { type: 'number' },
          tokenUpdatedAt: { type: 'string' },
          mcpUrl: { type: 'string' },
          configPath: { type: 'string' },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute() {
      const view = await ctx.store.view()
      const lines = [
        view.authorized ? '已授权（令牌更新于 ' + view.tokenUpdatedAt + '）' : '未授权',
        'MCP ' + (ctx.supervisor.isConnected() ? '已连接' : '未连接'),
        '已注册工具 ' + ctx.supervisor.toolCount() + ' 个',
        '端点 ' + view.mcpUrl,
        '配置路径 ' + view.configPath,
      ]
      return {
        ok: true,
        message: 'dsh-wps：' + lines.join('；') + '。' + (view.authorized
          ? '可直接使用 mcp__wps__* 工具；若未连接可先调 wps_test 建立连接。'
          : '请用 wps_oauth_start 开始授权。'),
        authorized: view.authorized,
        connected: ctx.supervisor.isConnected(),
        toolCount: ctx.supervisor.toolCount(),
        tokenUpdatedAt: view.tokenUpdatedAt,
        mcpUrl: view.mcpUrl,
        configPath: view.configPath,
      }
    },
  })
}

/** OAuth start tool: trigger the browser auth; on success, connect + register tools. */
function wpsOauthStartTool(ctx: ToolContext) {
  return defineTool({
    name: 'wps_oauth_start',
    description:
      '开始 WPS / 金山文档授权流程：打开 WPS 登录页（auth-guide），用户登录并授权后自动轮询拿到 token，随后建立 MCP 连接并把 mcp__wps__* 工具注册进来。授权成功后可关闭浏览器页面。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute() {
      try {
        await ctx.supervisor.ensureConnected()
        const count = ctx.supervisor.toolCount()
        return {
          ok: true,
          message: 'WPS 授权成功，已连接并注册 ' + count + ' 个 mcp__wps__* 工具。' +
            '用「WPS / 金山文档 / 云文档」开头描述需求即可调用。',
        }
      } catch (error) {
        return { ok: false, message: 'WPS 授权失败：' + String(error instanceof Error ? error.message : error) }
      }
    },
  })
}

/** Test tool: connect and report the number of discovered tools. */
function wpsTestTool(ctx: ToolContext) {
  return defineTool({
    name: 'wps_test',
    description:
      '测试 dsh-wps 连接：确认授权有效并列出 WPS SkillHub MCP 当前提供的工具数量（若未授权会触发浏览器授权）。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          toolCount: { type: 'number' },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute() {
      try {
        await ctx.supervisor.ensureConnected()
        const count = ctx.supervisor.toolCount()
        return {
          ok: true,
          message: 'WPS 连接成功，已加载 ' + count + ' 个 mcp__wps__* 工具。',
          toolCount: count,
        }
      } catch (error) {
        return { ok: false, message: 'WPS 连接失败：' + String(error instanceof Error ? error.message : error) }
      }
    },
  })
}

/** Clear tool: drop the stored token and disconnect. */
function wpsClearTool(ctx: ToolContext) {
  return defineTool({
    name: 'wps_clear',
    description:
      '清除 dsh-wps 已保存的 WPS access token 并断开 MCP 连接（不触发授权）。需要重新授权时，清除后再调 wps_oauth_start。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute() {
      await ctx.supervisor.dispose()
      await ctx.store.clearToken()
      return { ok: true, message: '已清除 WPS 授权并断开连接。请用 wps_oauth_start 重新授权。' }
    },
  })
}

/**
 * Mount the WPS helper tools, routes, and announcement.
 * @param ctx - host plugin context carrying tools/systemPrompt.
 * @param config - plugin config from the composition row.
 */
export function apply(ctx: Context, config?: Config): void {
  const announceToAgent = config?.announceToAgent !== false
  const enabled = config?.enabled !== false
  const store = new WpsStore()
  const supervisor = createSupervisor(ctx, store)
  const context: ToolContext = { store, supervisor }

  let disposeTools: (() => void) | undefined
  let disposeRoutes: (() => void) | undefined
  let disposeSection: (() => void) | undefined

  const sync = (): void => {
    if (disposeTools !== undefined) {
      disposeTools()
      disposeTools = undefined
    }
    if (disposeRoutes !== undefined) {
      disposeRoutes()
      disposeRoutes = undefined
    }
    if (disposeSection !== undefined) {
      disposeSection()
      disposeSection = undefined
    }
    if (!enabled) return
    disposeTools = ctx.effect(
      () => {
        const disposers = buildTools(context).map((tool) => ctx.tools.register(tool))
        return () => { for (const dispose of disposers) dispose() }
      },
      'dsh-wps: tools',
    )
    disposeRoutes = ctx.effect(
      () => {
        const disposers = makeRoutes(context).map((route) => ctx.webServer.register(route))
        return () => { for (const dispose of disposers) dispose() }
      },
      'dsh-wps: routes',
    )
    if (announceToAgent) {
      disposeSection = ctx.systemPrompt.section({
        name: 'plugin:dsh-wps',
        order: SECTION_ORDER,
        text: WPS_GUIDANCE,
      })
    }
  }

  sync()

  // Auto-connect when a token already exists (e.g. after a host restart).
  void (async () => {
    if (!enabled) return
    const view = await store.view()
    if (view.authorized && !supervisor.isConnected()) {
      void supervisor.ensureConnected().catch((error) => {
        ctx.logger.error(`dsh-wps: auto-connect failed: ${String(error)}`)
      })
    }
  })()

  ctx.effect(() => {
    return () => { void supervisor.dispose() }
  }, 'dsh-wps: connection')
}

/** Re-exports for host consumers and the smoke tests. */
export { WpsStore, mask, configPath, MCP_URL, AUTH_GUIDE_URL, EXCHANGE_URL, type WpsConfigView, type WpsCredentials } from './store.ts'
export { createSupervisor, publicToolName, type WpsSupervisor } from './mcp.ts'
export { authorize, ensureAuthenticated, openBrowser, pollToken } from './auth.ts'
export { makeRoutes, WPS_API } from './routes.ts'
export { defineTool }
