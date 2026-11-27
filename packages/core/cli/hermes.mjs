// Hermes bytecode for production bundles.
import { execFileSync } from 'node:child_process'
import { renameSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'

const HERMESC_BY_PLATFORM = {
  darwin: 'osx-bin/hermesc',
  linux: 'linux64-bin/hermesc',
  win32: 'win64-bin/hermesc.exe',
}

// -Xes6-block-scoping: a let in a loop is a variable per iteration, as when the runtime compiles source
// in development. Without it, callbacks made in the loop all see its last value.
export const HERMESC_OPTIONS = ['-O', '-w', '-Xes6-block-scoping']

export function hermescPath() {
  const packageDirectory = dirname(
    createRequire(import.meta.url).resolve('hermes-compiler/package.json'),
  )

  return `${packageDirectory}/hermesc/${HERMESC_BY_PLATFORM[process.platform]}`
}

// Hermes bytecode starts faster: no parsing when the app opens. The runtime tells bytecode from
// source on its own, so the file keeps its name.
export function compileToBytecode(bundlePath) {
  const bytecodePath = `${bundlePath}.hbc`

  execFileSync(
    hermescPath(),
    ['-emit-binary', ...HERMESC_OPTIONS, '-out', bytecodePath, bundlePath],
    {
      stdio: 'inherit',
    },
  )
  renameSync(bytecodePath, bundlePath)
}
