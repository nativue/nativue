import { fileURLToPath } from 'node:url'
import svgVitePlugin from './vite.mjs'

/**
 * Applied on its own once installed: its runtime registers <svg> before the app starts (by path, as the
 * package may be nested under @nativue/icons, out of the app's reach), and its Vite plugin handles
 * <style> in an <svg> and .svg imports.
 */
export default function svg() {
  return {
    name: '@nativue/svg',
    runtime: fileURLToPath(new URL('./src/runtime.ts', import.meta.url)),
    vite: svgVitePlugin(),
  }
}
