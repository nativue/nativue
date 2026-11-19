// The plugin, for nativue.config.ts: `plugins: [tailwind()]`. When the app is built, it scans the
// app's files for class names, has Tailwind generate their CSS (with the app's src/tailwind.css, if
// any) and converts it to styles. The app imports them before it runs (runtime.ts), so `class`
// works without Tailwind.
import { compile } from 'tailwindcss'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { stylesFromCss } from './convert.mjs'

const VIRTUAL_MODULE = 'virtual:nativue-tailwind'
const RESOLVED_VIRTUAL_MODULE = `\0${VIRTUAL_MODULE}`
const APP_STYLESHEET = 'src/tailwind.css'
// Without src/tailwind.css: the default theme and the utilities (no preflight, it styles HTML).
const DEFAULT_STYLESHEET = `@import 'tailwindcss/theme.css' layer(theme);
@import 'tailwindcss/utilities.css' layer(utilities);`
// The platform variants, as media queries convert.mjs turns into conditions (dark: is Tailwind's).
const PLATFORM_VARIANTS = `
@custom-variant ios (@media (nativue-platform: ios));
@custom-variant android (@media (nativue-platform: android));`
const SOURCE_EXTENSIONS = /\.(vue|[cm]?[jt]sx?)$/
const QUOTED_TEXT = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g
const CLASS_ATTRIBUTE = /(?:^|\s)(:class|v-bind:class|class)\s*=\s*(["'])([\s\S]*?)\2/g

const tailwindDirectory = dirname(
  createRequire(import.meta.url).resolve('tailwindcss/package.json'),
)

function sourceFiles(directory) {
  if (!existsSync(directory)) return []

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) return sourceFiles(path)

    return SOURCE_EXTENSIONS.test(entry.name) ? [path] : []
  })
}

function addWords(text, candidates) {
  for (const word of text.split(/\s+/)) if (word) candidates.add(word)
}

/**
 * Class names are looked for in quoted text (class="…", :class="{ 'p-4': … }", strings in scripts),
 * nested quotes included, so words in a template's text don't count.
 */
function addCandidates(text, candidates) {
  for (const [, , content] of text.matchAll(QUOTED_TEXT)) {
    addWords(content, candidates)
    addCandidates(content, candidates)
  }
}

/** The class names written in class and :class attributes: the ones worth a warning. */
function addClassAttributeCandidates(text, candidates) {
  for (const [, attribute, , content] of text.matchAll(CLASS_ATTRIBUTE)) {
    if (attribute === 'class') addWords(content, candidates)
    addCandidates(content, candidates)
  }
}

// `@import 'tailwindcss'` and its files come from the tailwindcss package; others are relative.
async function loadStylesheet(id, base) {
  const path =
    id === 'tailwindcss'
      ? `${tailwindDirectory}/index.css`
      : id.startsWith('tailwindcss/')
        ? `${tailwindDirectory}/${id.slice('tailwindcss/'.length)}`
        : resolve(base, id)

  return { path, base: dirname(path), content: readFileSync(path, 'utf8') }
}

async function loadModule(id) {
  throw new Error(
    `[nativue/tailwind] ${id}: @plugin and @config aren't supported, use @theme in CSS`,
  )
}

function vitePlugin() {
  const reportedClassNames = new Set()

  // Other quoted words (a script's 'inline', an attribute's "hidden") may not be classes at all.
  function reportIgnored(ignored, classAttributeCandidates) {
    for (const [className, reason] of Object.entries(ignored)) {
      if (reportedClassNames.has(className) || !classAttributeCandidates.has(className)) continue

      reportedClassNames.add(className)
      console.warn(`[nativue/tailwind] "${className}" ignored: ${reason}`)
    }
  }

  async function buildStyles(watchFile) {
    const stylesheetPath = resolve(APP_STYLESHEET)
    const hasAppStylesheet = existsSync(stylesheetPath)
    const stylesheet = hasAppStylesheet ? readFileSync(stylesheetPath, 'utf8') : DEFAULT_STYLESHEET
    const candidates = new Set()
    const classAttributeCandidates = new Set()

    if (hasAppStylesheet) watchFile(stylesheetPath)
    for (const file of sourceFiles(resolve('src'))) {
      const source = readFileSync(file, 'utf8')
      watchFile(file)
      addCandidates(source, candidates)
      addClassAttributeCandidates(source, classAttributeCandidates)
    }

    const compiler = await compile(stylesheet + PLATFORM_VARIANTS, {
      base: resolve('src'),
      loadStylesheet,
      loadModule,
    })
    const { styles, ignored } = stylesFromCss(compiler.build([...candidates]))
    reportIgnored(ignored, classAttributeCandidates)

    return styles
  }

  return {
    name: 'nativue-tailwind',

    resolveId(id) {
      return id === VIRTUAL_MODULE ? RESOLVED_VIRTUAL_MODULE : null
    },

    async load(id) {
      if (id !== RESOLVED_VIRTUAL_MODULE) return null

      const styles = await buildStyles((file) => this.addWatchFile(file))

      return `import { registerClassStyles } from '@nativue/tailwind/runtime'
registerClassStyles(${JSON.stringify(styles)})
import.meta.hot?.accept()`
    },
  }
}

export default function tailwind() {
  return { name: 'tailwind', vite: vitePlugin(), runtime: VIRTUAL_MODULE }
}
