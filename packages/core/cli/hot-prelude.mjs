// What the dev server puts before the bundle: Vite's module runtime and nativue's hot client.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const HOT_CLIENT_PATH = new URL('./hot-client.js', import.meta.url)
// The ESM syntax Hermes doesn't compile: the runtime's export list, and import() but not a method
// named import (`hooks.import(`).
export const EXPORT_LIST = /^export \{[^}]*\};?$/m
export const DYNAMIC_IMPORT = /(?<![.\w$])import\s*\(/g

export function hotPrelude(clientId, serverURL) {
  const viteRequire = createRequire(createRequire(import.meta.url).resolve('vite'))
  const runtime = readFileSync(viteRequire.resolve('rolldown/experimental/runtime'), 'utf8')
  const client = readFileSync(HOT_CLIENT_PATH, 'utf8')
  const options = JSON.stringify({ clientId, serverURL })

  return `${hermesCompatible(runtime)}\nvar __NATIVUE_HOT__ = ${options};\n${client}\n`
}

/**
 * Hermes compiles neither `export` nor `import()`. The runtime's import() loads lazy chunks, which
 * nativue builds without, so it's never called.
 */
function hermesCompatible(runtime) {
  return `function __nativueDynamicImport(specifier) {
  return Promise.reject(new Error('nativue builds without lazy chunks: ' + specifier))
}
${runtime.replace(EXPORT_LIST, '').replace(DYNAMIC_IMPORT, '__nativueDynamicImport(')}`
}
