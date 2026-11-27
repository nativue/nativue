import { fileURLToPath } from 'node:url'

/**
 * Applied on its own once installed: its runtime registers <svg> and the components before the app
 * starts. By path, as the package may be nested under @nativue/icons, out of the app's reach.
 */
export default function svg() {
  return {
    name: '@nativue/svg',
    runtime: fileURLToPath(new URL('./src/runtime.ts', import.meta.url)),
  }
}
