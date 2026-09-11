/**
 * dsh-wps — browser half. Registers the WPS settings panel into the web
 * settings page (settings.section entry). The panel drives the browser
 * authorization, shows connection state, and offers one-click test / clear.
 * Failure policy: registration problems are logged, never thrown — the web
 * shell fails the whole boot when a plugin apply throws, and an external
 * plugin must not take the GUI down.
 */
// Type-only: pulls the settings-surface SlotMap merge (the 'settings.section'
// entry) and the client runtime Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { WpsSettingsPanel } from './WpsPanel.tsx'

/** Required services. */
export const inject = ['slots']

/**
 * Register the WPS settings page.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  try {
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: 'wps',
      order: 330,
      label: () => 'WPS',
    }, WpsSettingsPanel))
  } catch (error) {
    console.warn('[dsh-wps] settings panel registration failed:', error)
  }
}
