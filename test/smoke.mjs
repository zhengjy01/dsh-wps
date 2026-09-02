// dsh-wps smoke test (no network): exercises the pure, non-network helpers.
// Run with: node test/smoke.mjs
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { publicToolName } = require('../lib/index.js')

function assert(cond, msg) {
  if (!cond) throw new Error('smoke failed: ' + msg)
  console.log('  ✓ ' + msg)
}

console.log('dsh-wps smoke')

// Plugin entry module shape (cordis contract): name + apply + store/supervisor exports.
const mod = require('../lib/index.js')
assert(mod.name === 'wps', 'cordis plugin name is "wps"')
assert(typeof mod.apply === 'function', 'apply() is a function')
assert(typeof mod.WpsStore === 'function', 'WpsStore exported')
assert(typeof mod.createSupervisor === 'function', 'createSupervisor exported')

// publicToolName: normal case
assert(publicToolName('list_my_files') === 'mcp__wps__list_my_files', 'normal name maps to mcp__wps__list_my_files')
assert(publicToolName('sheet.get_range_data') === 'mcp__wps__sheet_get_range_data', 'dotted name normalized to underscores (readable, no hash)')

// publicToolName: lossy normalization (invalid chars) produces a hashed suffix
const bad = publicToolName('a/b c:d')
assert(/^mcp__wps__a_b_c_d_[a-f0-9]{12}$/.test(bad), 'invalid chars normalized + hashed (' + bad + ')')

// publicToolName: name longer than 64 chars gets truncated + hashed
const long = publicToolName('x'.repeat(80))
assert(long.length <= 64 && /_[a-f0-9]{12}$/.test(long), 'long name truncated + hashed')

console.log('  all smoke assertions passed')
