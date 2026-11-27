// Node runs the other tests on V8, where let in a loop already works: this checks Hermes's bytecode.
import assert from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HERMESC_OPTIONS, hermescPath } from '../cli/hermes.mjs'

const LOOP =
  'var callbacks = []\nfor (let index = 0; index < 3; index++) callbacks.push(() => index)\n'

/** outputOptions(directory): where hermesc writes, inside the temporary directory it also cleans. */
function compile(source, outputOptions) {
  const directory = mkdtempSync(join(tmpdir(), 'nativue-hermes-'))
  const sourcePath = join(directory, 'source.js')

  writeFileSync(sourcePath, source)
  try {
    return execFileSync(
      hermescPath(),
      [...outputOptions(directory), ...HERMESC_OPTIONS, sourcePath],
      {
        encoding: 'utf8',
        stdio: 'pipe',
      },
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

const bytecode = compile(LOOP, () => ['-dump-bytecode'])

// A variable per iteration: the environment the callback closes over is made inside the loop (L1).
const globalFunction = bytecode.slice(
  bytecode.indexOf('Function<global>'),
  bytecode.indexOf('Function<>'),
)
const loopBody = globalFunction.slice(globalFunction.indexOf('L1:'))

assert.match(
  loopBody,
  /CreateFunctionEnvironment/,
  'let in a loop shares one variable across iterations',
)

console.log('ok - production bytecode gives a let in a loop a variable per iteration')

// The dev server's prelude comes from Vite's runtime: an update to it must still compile on Hermes.
const { DYNAMIC_IMPORT, EXPORT_LIST, hotPrelude } = await import('../cli/hot-prelude.mjs')
const prelude = hotPrelude('client', 'http://localhost:40836')

assert.doesNotMatch(prelude, EXPORT_LIST, "the runtime's export list changed shape")
assert.doesNotMatch(
  prelude,
  new RegExp(DYNAMIC_IMPORT.source),
  'an import( was left in the prelude',
)
compile(prelude, (directory) => ['-emit-binary', '-out', join(directory, 'prelude.hbc')])

console.log("ok - the dev server's prelude compiles on Hermes")
