// dsh-wps apply() cordis-wiring test (no network, no real config file).
// Builds a mock host ctx and asserts the plugin registers its helper tools,
// system-prompt announcement, and API routes; then drives wps_status end-to-end.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const tmp = mkdtempSync(path.join(tmpdir(), 'dsh-wps-'))
process.env.DSH_WPS_CONFIG = path.join(tmp, 'dsh-wps.json')

const { apply, name, WPS_API } = await import('../lib/index.js')

function assert(cond, msg) {
  if (!cond) throw new Error('apply test failed: ' + msg)
  console.log('  ✓ ' + msg)
}

const tools = []
const sections = []
const routes = []

const ctx = {
  logger: { info: () => {}, warn: (m) => console.log('  [warn] ' + m), error: (m) => console.log('  [error] ' + m) },
  effect(fn) {
    const dispose = fn()
    return () => { if (typeof dispose === 'function') dispose() }
  },
  tools: { register(tool) { tools.push(tool); return () => {} } },
  systemPrompt: { section(cfg) { sections.push(cfg); return () => {} } },
  webServer: { register(route) { routes.push(route); return () => {} } },
}

console.log('dsh-wps apply() wiring')

assert(name === 'wps', 'plugin name is wps')

apply(ctx, { enabled: true, announceToAgent: true })

// Helper tools registered.
const toolNames = tools.map((t) => t.name)
assert(toolNames.length === 4, 'registered 4 helper tools (' + toolNames.join(', ') + ')')
for (const expected of ['wps_status', 'wps_oauth_start', 'wps_test', 'wps_clear']) {
  assert(toolNames.includes(expected), 'helper tool ' + expected + ' registered')
}

// Each tool has the DSH output contract.
const statusTool = tools.find((t) => t.name === 'wps_status')
assert(statusTool && typeof statusTool.execute === 'function', 'wps_status has execute()')
assert(typeof statusTool.output?.render === 'function', 'wps_status has output.render()')
assert(typeof statusTool.parameters !== 'undefined', 'wps_status has parameters()')

// System prompt announcement section.
assert(sections.length === 1, 'registered 1 system-prompt section')
assert(sections[0].name === 'plugin:dsh-wps', 'section name is plugin:dsh-wps')
assert(sections[0].text.includes('mcp__wps__'), 'section text mentions mcp__wps__')

// API routes.
const routePaths = routes.map((r) => r.path)
assert(routePaths.length === 4, 'registered 4 routes')
for (const p of Object.values(WPS_API)) {
  assert(routePaths.includes(p), 'route ' + p + ' registered')
}

// Drive wps_status end-to-end (no network; store file absent => unauthorized).
const result = await statusTool.execute({})
assert(result.ok === true, 'wps_status returns ok:true')
assert(result.authorized === false, 'wps_status reports not authorized (no token yet)')
const rendered = statusTool.output.render({}, result)
assert(Array.isArray(rendered) && rendered[0].type === 'text' && typeof rendered[0].text === 'string', 'wps_status.render returns a text block')
assert(rendered[0].text.includes('未授权'), 'render text says 未授权')

// Disposal effect run (simulate plugin unload).
rmSync(tmp, { recursive: true, force: true })
console.log('  all apply() wiring assertions passed')
