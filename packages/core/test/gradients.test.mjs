// backgroundImage's parser (src/gradients.ts), with the CSS that trips it.
import assert from 'node:assert'
import { registerHooks } from 'node:module'

// The sources import each other without the .ts Vite resolves.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!specifier.startsWith('.')) throw error

      return nextResolve(`${specifier}.ts`, context)
    }
  },
})

const { processBackgroundImage } = await import('../src/gradients.ts')
const { parseColor } = await import('../src/colors.ts')
const warnings = []
console.warn = (message) => warnings.push(message)

// A stop without a position before one with: spread between its neighbours.
assert.deepEqual(
  processBackgroundImage('linear-gradient(red, yellow, blue 100%)')[0].positions,
  [0, 0.5, 1],
)
assert.deepEqual(
  processBackgroundImage('linear-gradient(red, orange, yellow 50%, blue)')[0].positions,
  [0, 0.25, 0.5, 1],
)

// The color space, before or after the direction, and keywords in any case.
assert.equal(processBackgroundImage('linear-gradient(in oklab 90deg, red, blue)')[0].angle, 90)
assert.deepEqual(
  processBackgroundImage('linear-gradient(to Right in hsl longer hue, red, blue)')[0].to,
  ['right'],
)
assert.equal(processBackgroundImage('radial-gradient(CIRCLE, red, blue)')[0].shape, 'circle')

// Positions: a keyword names its axis whatever the order; edges with offsets.
assert.deepEqual(processBackgroundImage('radial-gradient(at center left, red, blue)')[0].center, [
  [0, 0],
  [0.5, 0],
])
assert.deepEqual(
  processBackgroundImage('radial-gradient(at right 10px top 20%, red, blue)')[0].center,
  [
    [1, -10],
    [0.2, 0],
  ],
)

// Stops past the ends: cut at 0 and 1, with the colors there.
const past = processBackgroundImage('linear-gradient(red -50%, blue 150%)')[0]
const [red, blue] = [parseColor('red'), parseColor('blue')]
assert.deepEqual(past.positions, [0, 1])
assert.notEqual(past.colors[0], red)
assert.notEqual(past.colors[1], blue)

// Settings and color hints are told from colors without warning.
processBackgroundImage('linear-gradient(135deg, red, 30%, blue)')
assert.deepEqual(warnings, [])

console.log('ok - parses CSS gradients')
