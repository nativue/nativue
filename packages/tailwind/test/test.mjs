// Converts what Tailwind generates for a set of classes and checks the native styles.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { compile } from 'tailwindcss'
import { color, evaluateLength, stylesFromCss } from '../src/convert.mjs'

const tailwindDirectory = dirname(
  createRequire(import.meta.url).resolve('tailwindcss/package.json'),
)

async function stylesOf(classNames, theme = '') {
  const compiler = await compile(`@import 'tailwindcss';\n${theme}`, {
    base: tailwindDirectory,
    async loadStylesheet(id, base) {
      const path = id === 'tailwindcss' ? `${tailwindDirectory}/index.css` : `${base}/${id}`
      return { path, base: dirname(path), content: readFileSync(path, 'utf8') }
    },
  })
  const { styles: entries, ignored } = stylesFromCss(compiler.build(classNames))
  const styles = Object.fromEntries(
    Object.entries(entries).map(([name, [, style]]) => [name, style]),
  )

  return { entries, styles, ignored }
}

// ---------- Values ----------

assert.deepEqual(evaluateLength('calc(0.25rem * -4)'), { number: -16, unit: 'px' })
assert.deepEqual(evaluateLength('calc(1 / 2 * 100%)'), { number: 50, unit: '%' })
assert.equal(evaluateLength('100vw'), null)
assert.equal(evaluateLength('min(1px, 2px)'), null)

assert.equal(color('oklch(63.7% 0.237 25.331)'), '#fb2c36') // Tailwind's red-500
assert.equal(color('rgb(0 0 0 / 0.1)'), '#0000001a')
assert.equal(color('rgba(0, 0, 0, 0.5)'), '#00000080')
assert.equal(color('color-mix(in oklab, #fff 10%, transparent)'), '#ffffff1a')
assert.equal(color('red'), 'red')
assert.equal(color('currentcolor'), null)

// ---------- Utilities ----------

const { styles, ignored } = await stylesOf([
  'p-4',
  'px-2',
  'ps-3',
  '-mt-4',
  'mx-auto',
  'w-1/2',
  'size-4',
  'max-w-md',
  'inset-0',
  'flex-1',
  'flex-auto',
  'grow',
  'aspect-video',
  'hidden',
  'flex-row',
  'items-start',
  'justify-between',
  'gap-x-2',
  'rounded-full',
  'rounded-lg',
  'border',
  'bg-black/50',
  'bg-[#ff0000]',
  'text-xl',
  'font-bold',
  'text-center',
  'opacity-50',
  'rotate-45',
  'scale-x-50',
  'translate-y-2',
  'shadow-md',
  'shadow-none',
  '!p-2',
  'z-10',
  'hover:bg-red-500',
  'space-x-4',
])

assert.deepEqual(styles, {
  'p-4': { padding: 16 },
  'px-2': { paddingHorizontal: 8 },
  'ps-3': { paddingStart: 12 },
  '-mt-4': { marginTop: -16 },
  'mx-auto': { marginHorizontal: 'auto' },
  'w-1/2': { width: '50%' },
  'size-4': { width: 16, height: 16 },
  'max-w-md': { maxWidth: 448 },
  'inset-0': { top: 0, right: 0, bottom: 0, left: 0 },
  'flex-1': { flex: 1 },
  'flex-auto': { flexGrow: 1, flexShrink: 1, flexBasis: 'auto' },
  grow: { flexGrow: 1 },
  'aspect-video': { aspectRatio: 16 / 9 },
  hidden: { display: 'none' },
  'flex-row': { flexDirection: 'row' },
  'items-start': { alignItems: 'flex-start' },
  'justify-between': { justifyContent: 'space-between' },
  'gap-x-2': { columnGap: 8 },
  'rounded-full': { borderRadius: 9999 },
  'rounded-lg': { borderRadius: 8 },
  border: { borderWidth: 1 },
  'bg-black/50': { backgroundColor: '#00000080' },
  'bg-[#ff0000]': { backgroundColor: '#ff0000' },
  'text-xl': { fontSize: 20 }, // its line-height has no native equivalent
  'font-bold': { fontWeight: '700' },
  'text-center': { textAlign: 'center' },
  'opacity-50': { opacity: 0.5 },
  'rotate-45': { transform: [{ rotate: '45deg' }] },
  'scale-x-50': { transform: [{ scaleX: 0.5 }, { scaleY: 1 }] },
  'translate-y-2': { transform: [{ translateY: 8 }] },
  'shadow-md': {
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 4 },
  },
  'shadow-none': { shadowOpacity: 0 },
  '!p-2': { padding: 8 },
})

assert.deepEqual(Object.keys(ignored).sort(), ['hover:bg-red-500', 'space-x-4', 'z-10'])
assert.match(ignored['z-10'], /z-index/)

// ---------- Variants ----------

// dark: and active: are Tailwind's; ios: and android: come from the stylesheet (index.mjs adds them).
const platformVariants = `@custom-variant ios (@media (nativue-platform: ios));
@custom-variant android (@media (nativue-platform: android));`
const { entries: variantEntries, ignored: variantIgnored } = await stylesOf(
  [
    'dark:p-1',
    'active:p-2',
    'ios:p-3',
    'android:p-4',
    'dark:active:p-5',
    'md:p-6',
    'focus:p-7',
    'disabled:p-8',
    'focus-visible:p-9',
  ],
  platformVariants,
)
const conditionsOf = (className) => variantEntries[className][2]
assert.deepEqual(conditionsOf('dark:p-1'), ['dark'])
assert.deepEqual(conditionsOf('active:p-2'), ['pressed'])
assert.deepEqual(conditionsOf('ios:p-3'), ['ios'])
assert.deepEqual(conditionsOf('android:p-4'), ['android'])
assert.deepEqual(conditionsOf('dark:active:p-5'), ['dark', 'pressed'])
assert.deepEqual(conditionsOf('focus:p-7'), ['focused'])
assert.deepEqual(conditionsOf('disabled:p-8'), ['disabled'])
assert.deepEqual(variantEntries['dark:p-1'][1], { padding: 4 })
assert.deepEqual(Object.keys(variantIgnored).sort(), ['focus-visible:p-9', 'md:p-6'])

// ---------- Order and theme ----------

// Later rules win: Tailwind puts px-2 after p-4 whatever the order in class="…".
const { entries } = await stylesOf(['px-2', 'p-4'])
assert.ok(entries['p-4'][0] < entries['px-2'][0])

// @theme in the app's stylesheet.
const { styles: themedStyles } = await stylesOf(
  ['bg-brand', 'p-18'],
  '@theme { --color-brand: #0e9f84; --spacing: 2px; }',
)
assert.deepEqual(themedStyles, {
  'bg-brand': { backgroundColor: '#0e9f84' },
  'p-18': { padding: 36 },
})

console.log('ok')
