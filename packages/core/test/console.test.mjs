// src/console.ts: how values print, as Node and browsers print them, and table, group and assert.
import assert from 'node:assert'

const { createConsole, formatValues } = await import('../src/console.ts')

const printed = []
const console = createConsole((level, text) => printed.push([level, text]))

function lastPrinted() {
  return printed.at(-1)
}

// Values: strings as they are, the rest inspected.
assert.equal(formatValues(['count', 3, true, null, undefined]), 'count 3 true null undefined')
assert.equal(
  formatValues([{ name: 'Ana', tags: ['a', 'b'] }]),
  "{ name: 'Ana', tags: [ 'a', 'b' ] }",
)
assert.equal(formatValues([{ 'needs-quotes': 1 }]), "{ 'needs-quotes': 1 }")
assert.equal(formatValues([{ a: { b: { c: { d: 1 } } } }]), '{ a: { b: { c: [Object] } } }')
assert.equal(
  formatValues([new Map([['key', 1]]), new Set([2])]),
  "Map(1) { 'key' => 1 } Set(1) { 2 }",
)
assert.equal(
  formatValues([function save() {}, () => {}]),
  '[Function: save] [Function: (anonymous)]',
)
assert.equal(formatValues([10n, Symbol('id')]), '10n Symbol(id)')
assert.equal(formatValues([[], {}]), '[] {}')

class Point {
  x = 1
}
assert.equal(formatValues([new Point()]), 'Point { x: 1 }')

const circular = { name: 'loop' }
circular.self = circular
assert.equal(formatValues([circular]), "{ name: 'loop', self: [Circular] }")

// Long objects: one entry per line.
const long = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`key${index}`, 'value']))
assert.ok(formatValues([long]).startsWith("{\n  key0: 'value',\n"))

// Substitutions, and what's left after them.
assert.equal(formatValues(['%s has %d items', 'cart', '3']), 'cart has 3 items')
assert.equal(formatValues(['%i%%', 42.9]), '42%')
assert.equal(formatValues(['%f', '1.5']), '1.5')
assert.equal(formatValues(['%o', { a: 1 }]), '{ a: 1 }')
assert.equal(formatValues(['%cstyled', 'color: red']), 'styled')
assert.equal(formatValues(['%s', 'a', 'extra']), 'a extra')
assert.equal(formatValues(['%s and %s', 'one']), 'one and %s')

// Levels.
console.info('info')
assert.deepEqual(lastPrinted(), ['info', 'info'])
console.debug('debug')
assert.deepEqual(lastPrinted(), ['debug', 'debug'])
console.warn('warn')
assert.deepEqual(lastPrinted(), ['warn', 'warn'])

// Groups indent what's inside, every line of it.
console.group('Cart')
console.log('line 1\nline 2')
console.groupCollapsed()
console.log('nested')
console.groupEnd()
console.groupEnd()
console.groupEnd()
console.log('after')
assert.deepEqual(printed.slice(-4), [
  ['log', 'Cart'],
  ['log', '  line 1\n  line 2'],
  ['log', '    nested'],
  ['log', 'after'],
])

// assert prints only when the condition is false.
const countBefore = printed.length
console.assert(true, 'never')
assert.equal(printed.length, countBefore)
console.assert(false, 'total is %d', 5)
assert.deepEqual(lastPrinted(), ['error', 'Assertion failed: total is 5'])
console.assert(0)
assert.deepEqual(lastPrinted(), ['error', 'Assertion failed'])

// trace: the message, then where it was called from.
console.trace('here')
assert.ok(lastPrinted()[1].startsWith('Trace: here\n'))
assert.ok(!lastPrinted()[1].includes('Error'))

// table: a column per key, Values for what isn't an object.
console.table([{ name: 'Ana', age: 30 }, { name: 'Bia' }, 'plain'])
assert.equal(
  lastPrinted()[1],
  [
    '┌─────────┬───────┬─────┬─────────┐',
    '│ (index) │ name  │ age │ Values  │',
    '├─────────┼───────┼─────┼─────────┤',
    "│ 0       │ 'Ana' │ 30  │         │",
    "│ 1       │ 'Bia' │     │         │",
    "│ 2       │       │     │ 'plain' │",
    '└─────────┴───────┴─────┴─────────┘',
  ].join('\n'),
)
console.table({ first: { id: 1 } }, ['id'])
assert.ok(lastPrinted()[1].includes('│ first   │ 1  │'))
console.table('not a table')
assert.deepEqual(lastPrinted(), ['log', 'not a table'])

// Long arrays and strings are cut, as Node cuts them.
const many = formatValues([Array.from({ length: 102 }, (_, index) => index)])
assert.ok(many.includes('99,\n') && many.endsWith('... 2 more items\n]'))
assert.ok(formatValues([['x'.repeat(10_005)]]).includes("... 5 more characters'"))

// Values that can't be numbers are NaN, never a throw.
assert.equal(formatValues(['%d %i %f', Symbol('id'), Object.create(null), {}]), 'NaN NaN NaN')

// The rest does nothing, without throwing.
for (const name of [
  'time',
  'timeEnd',
  'timeLog',
  'count',
  'countReset',
  'dir',
  'clear',
  'profile',
]) {
  console[name]('label')
}

process.stdout.write('ok - console\n')
