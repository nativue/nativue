// Node runs the other tests on V8, where let in a loop already works: this checks Hermes's bytecode.
import assert from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HERMESC_OPTIONS, hermescPath } from '../cli/hermes.mjs'

const LOOP =
  'var callbacks = []\nfor (let index = 0; index < 3; index++) callbacks.push(() => index)\n'

const directory = mkdtempSync(join(tmpdir(), 'nativue-hermes-'))
const sourcePath = join(directory, 'loop.js')

writeFileSync(sourcePath, LOOP)

const bytecode = execFileSync(hermescPath(), ['-dump-bytecode', ...HERMESC_OPTIONS, sourcePath], {
  encoding: 'utf8',
})

rmSync(directory, { recursive: true, force: true })

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
