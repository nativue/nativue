// Converts what Tailwind generates for a set of classes and checks the native styles.
import assert from 'node:assert'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { compile } from 'tailwindcss'
import { color, evaluateLength, stylesFromCss } from '../src/convert.mjs'
import tailwind from '../src/index.mjs'

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
  'underline',
  'line-through',
  'no-underline',
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
  underline: { textDecorationLine: 'underline' },
  'line-through': { textDecorationLine: 'line-through' },
  'no-underline': { textDecorationLine: 'none' },
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
    'dark:bg-black/50',
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
assert.deepEqual(conditionsOf('dark:bg-black/50'), ['dark'])
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

// ---------- Text and corners ----------

const text = await stylesOf([
  'italic',
  'uppercase',
  'tracking-wide',
  'leading-6',
  'leading-tight',
  'text-sm',
  'line-clamp-2',
  'truncate',
  'rounded-t-lg',
  'rounded-ee-lg',
])
assert.deepEqual(text.styles.italic, { fontStyle: 'italic' })
assert.deepEqual(text.styles.uppercase, { textTransform: 'uppercase' })
// Ems stay ems, multiplied by the font size natively; a unitless line height is in ems too.
assert.deepEqual(text.styles['tracking-wide'], { letterSpacing: '0.025em' })
assert.deepEqual(text.styles['leading-6'], { lineHeight: 24 })
assert.deepEqual(text.styles['leading-tight'], { lineHeight: '1.25em' })
// text-sm's own line height is left out: text keeps the platform's unless leading-* sets one.
assert.deepEqual(text.styles['text-sm'], { fontSize: 14 })
assert.equal(text.styles['line-clamp-2'].lineClamp, 2)
assert.equal(text.styles.truncate.lineClamp, 1)
// text-ellipsis alone doesn't cut text to one line, as on the web.
const ellipsis = await stylesOf(['text-ellipsis'])
assert.equal(ellipsis.styles['text-ellipsis'], undefined)
assert.deepEqual(text.styles['rounded-t-lg'], { borderTopLeftRadius: 8, borderTopRightRadius: 8 })
assert.deepEqual(text.styles['rounded-ee-lg'], { borderBottomRightRadius: 8 })

// ---------- Gradients ----------

// bg-linear-to-r, from-*, via-* and to-* each set variables; the backgroundImage reads them, and is
// resolved per element at run time (runtime.ts), from the variables of its classes.
const gradients = await stylesOf([
  'bg-linear-to-r',
  'from-red-500',
  'to-90%',
  'bg-[linear-gradient(45deg,red,blue)]',
])
assert.deepEqual(gradients.styles['bg-linear-to-r'], {
  '--tw-gradient-position': 'to right',
  backgroundImage: 'linear-gradient(var(--tw-gradient-stops))',
})
// Theme colors (oklch) arrive as hex, which native reads.
assert.equal(gradients.styles['from-red-500']['--tw-gradient-from'], '#fb2c36')
assert.equal(gradients.styles['to-90%']['--tw-gradient-to-position'], '90%')
// An arbitrary gradient needs no variable.
assert.equal(
  gradients.styles['bg-[linear-gradient(45deg,red,blue)]'].backgroundImage,
  'linear-gradient(45deg,red,blue)',
)
assert.equal(gradients.ignored['bg-linear-to-r'], undefined)

// The ! modifier, a color with an opacity under dark: (Tailwind writes two rules for it), and what
// native can't draw: a conic gradient, the text's color.
const edgeCases = await stylesOf([
  '!bg-linear-to-r',
  'dark:from-black/50',
  'bg-conic',
  'from-current',
])
assert.equal(
  edgeCases.styles['!bg-linear-to-r'].backgroundImage,
  'linear-gradient(var(--tw-gradient-stops))',
)
assert.equal(edgeCases.styles['!bg-linear-to-r']['--tw-gradient-position'], 'to right')
assert.equal(edgeCases.styles['dark:from-black/50']['--tw-gradient-from'], '#00000080')
assert.ok(edgeCases.styles['dark:from-black/50']['--tw-gradient-stops'])
assert.match(edgeCases.ignored['bg-conic'], /background-image/)
assert.match(edgeCases.ignored['from-current'], /--tw-gradient-from/)

// A ring or an inset shadow has no native equivalent, and leaves shadow-md's shadow alone;
// shadow-none takes it away.
const shadows = await stylesOf(['shadow-md', 'ring-2', 'inset-shadow-sm', 'shadow-none'])
assert.equal(shadows.styles['ring-2'], undefined)
assert.equal(shadows.styles['inset-shadow-sm'], undefined)
assert.match(shadows.ignored['ring-2'], /box-shadow/)
assert.deepEqual(shadows.styles['shadow-none'], { shadowOpacity: 0 })

// ---------- Warnings ----------

async function warningsFor(template) {
  const appDirectory = mkdtempSync(join(tmpdir(), 'nativue-tailwind-'))
  mkdirSync(join(appDirectory, 'src'))
  writeFileSync(join(appDirectory, 'src/App.vue'), template)

  const warnings = []
  const warn = console.warn
  const workingDirectory = process.cwd()
  console.warn = (message) => warnings.push(message)
  process.chdir(appDirectory)
  try {
    await tailwind().vite.load.call({ addWatchFile() {} }, '\0virtual:nativue-tailwind')
  } finally {
    process.chdir(workingDirectory)
    console.warn = warn
  }

  return warnings.join('\n')
}

const warnings = await warningsFor(
  `<template><View :class="['p-4', block && 'self-stretch']" class="z-10" /></template>`,
)
assert.doesNotMatch(warnings, /"block"/)
assert.match(warnings, /"z-10"/)

console.log('ok')
