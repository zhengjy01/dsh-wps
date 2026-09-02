/**
 * Standalone build config for the dsh-wps plugin.
 *
 * Host half: lib/index.js (node) from src/index.ts. Browser half: lib/client.js
 * (closure-factory artifact for the GUI's __ModuleLoader__, served at
 * /plugins/wps/client.js) from src/client/index.ts, via the bundled shared
 * client-bundle preset (shared/tsdown.client.ts, vendored from the dsh-web-ui
 * family repo).
 */
import { clientBundle } from './shared/tsdown.client.ts'

export default clientBundle('dsh-wps', ['src/index.ts'], {
  libExternal: [
    '@deepseek-ai/dsh-host-webserver',
    '@deepseek-ai/dsh-system-prompt',
    '@deepseek-ai/dsh-tools',
  ],
})
