import { registerSW } from 'virtual:pwa-register'

/**
 * Registers the service worker.  With registerType 'autoUpdate' a new build
 * is fetched in the background and used on the next open, so artists always
 * get the current app without reinstalling.
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return
  registerSW({ immediate: true })
}
