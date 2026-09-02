/**
 * WPS / 金山文档 settings panel — rendered inside the web settings page
 * (settings.section entry). Drives the browser authorization (host-side
 * auth-guide + exchange poll, no popup URL to paste — the host opens the
 * browser), shows connection state and registered tool count, and offers
 * one-click test / clear. Plain React, inline styles.
 */
import { useCallback, useEffect, useState } from 'react'
import { WpsApi, type WpsStatusView } from './api.ts'

/** Module-level API client (stateless; the component closes over it). */
const api = new WpsApi()

/** One shared style sheet (kept tiny and theme-agnostic). */
const s = {
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    maxWidth: '620px',
    padding: '14px 16px',
    borderRadius: '10px',
    border: '1px solid rgba(128,128,128,0.3)',
    fontSize: '13px',
    color: 'inherit',
  } as const,
  title: { fontWeight: 600, fontSize: '13px', margin: 0 } as const,
  status: { fontSize: '12px', opacity: 0.85 } as const,
  statusWarn: { fontSize: '12px', opacity: 0.9, color: '#c9763a' } as const,
  row: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } as const,
  flex: { flex: 1 } as const,
  button: {
    padding: '4px 10px',
    borderRadius: '6px',
    cursor: 'pointer',
    border: '1px solid rgba(128,128,128,0.4)',
    background: 'rgba(128,128,128,0.14)',
    color: 'inherit',
    fontSize: '12px',
    whiteSpace: 'nowrap',
  } as const,
  msg: { fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', opacity: 0.9 } as const,
  hint: { fontSize: '11px', opacity: 0.75, lineHeight: 1.6 } as const,
}

/** Status line for the current view. */
function statusText(view: WpsStatusView | null): string {
  if (view === null) return '加载中…'
  if (!view.authorized) return '未授权 — 点击「开始授权」，浏览器会打开 WPS 登录页，登录并授权后工具即可用。'
  const connected = view.connected ? '已连接' : '未连接'
  return `已授权 · 令牌更新于 ${view.tokenUpdatedAt} · MCP ${connected} · 工具 ${view.toolCount} 个`
}

/** The settings panel component. */
export function WpsSettingsPanel(): JSX.Element {
  const [view, setView] = useState<WpsStatusView | null>(null)
  const [tools, setTools] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [msg, setMsg] = useState('')

  const refreshStatus = useCallback(async () => {
    try {
      setView(await api.status())
    } catch (error) {
      setMsg('读取状态失败: ' + String(error instanceof Error ? error.message : error))
    }
  }, [])

  useEffect(() => { void refreshStatus() }, [refreshStatus])

  // Reload status when the tab regains focus (the WPS login tab may have closed).
  useEffect(() => {
    const onFocus = (): void => { void refreshStatus() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshStatus])

  // While authorization is underway, poll status until the token lands.
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(async () => {
      try {
        const next = await api.status()
        setView(next)
        if (next.authorized) {
          const result = await api.test()
          setView(result.view)
          if (result.ok && result.tools !== undefined) setTools(result.tools)
          setMsg(result.ok ? (result.message ?? '授权成功。') : ('[failed] ' + (result.error ?? '')))
          setWaiting(false)
        }
      } catch {
        // keep polling
      }
    }, 2500)
    return () => clearInterval(timer)
  }, [waiting])

  /** Run one async panel action with busy/message bookkeeping. */
  const run = async (action: () => Promise<{ message: string } | void>): Promise<void> => {
    setBusy(true)
    setMsg('')
    try {
      const result = await action()
      if (result !== undefined) setMsg(result.message)
    } catch (error) {
      setMsg('操作失败: ' + String(error instanceof Error ? error.message : error))
    } finally {
      setBusy(false)
    }
  }

  const authorize = (): void => {
    void run(async () => {
      const result = await api.oauthStart()
      setView(result.view)
      if (result.ok) {
        setWaiting(true)
        return { message: (result.started ? '已打开 WPS 登录页，请在浏览器完成登录授权…' : result.message) }
      }
      return { message: '[failed] ' + (result.error ?? '开始授权失败') }
    })
  }

  const test = (): void => {
    void run(async () => {
      const result = await api.test()
      setView(result.view)
      if (result.ok && result.tools !== undefined) setTools(result.tools)
      return { message: result.ok ? (result.message ?? '连接成功。') : ('[failed] ' + (result.error ?? '')) }
    })
  }

  const clear = (): void => {
    void run(async () => {
      if (!window.confirm('确定清除 WPS 授权吗？之后需要重新授权。')) return { message: '已取消。' }
      const result = await api.clear()
      setView(result.view)
      setTools([])
      setWaiting(false)
      return { message: result.message }
    })
  }

  const authorized = Boolean(view && view.authorized)

  return (
    <div style={s.card}>
      <p style={s.title}>WPS / 金山文档</p>
      <div style={authorized ? s.status : s.statusWarn}>{statusText(view)}</div>

      <div style={s.hint}>
        通过金山文档官方 SkillHub MCP（{view?.mcpUrl ?? 'https://mcp-center.wps.cn/skill_hub/mcp'}）连接，授权后云文档工具以
        mcp__wps__* 形式在会话中可用（云盘列表/搜索/读取/创建/上传下载 + 文字/表格/演示/PDF 内容读写）。
        令牌存 {view?.configPath ?? '~/.dsh/dsh-wps.json'}（权限 0600）。请使用个人 WPS 账号授权。
      </div>

      <div style={s.row}>
        <button style={s.button} onClick={authorize} disabled={busy || authorized}>开始授权</button>
        <button style={s.button} onClick={test} disabled={busy || !authorized}>测试连接</button>
        <button style={s.button} onClick={clear} disabled={busy || !authorized}>清除授权</button>
      </div>

      {tools.length > 0 && (
        <div style={s.hint}>已发现的 MCP 工具（{tools.length}）：{tools.slice(0, 12).join('、')}{tools.length > 12 ? '…' : ''}</div>
      )}

      {msg !== '' && <div style={s.msg}>{msg}</div>}
    </div>
  )
}
