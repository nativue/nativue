#!/usr/bin/env node
// npm create nativue@latest my-app [-- --bundle-id com.company.myapp]
// npm create nativue@latest nativue-battery -- --module
// Copies template/app (an app) or template/package (a package with native code) into a new folder
// and fills in the names.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const APP_TEMPLATE = fileURLToPath(new URL('./template/app', import.meta.url))
const PACKAGE_TEMPLATE = fileURLToPath(new URL('./template/package', import.meta.url))
const TEXT_FILE = /(\.(json|vue|ts|md|swift|kt|kts)|gitignore)$/
// npm's rule: lowercase, an optional @scope.
const PACKAGE_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/
// Also the Android package and applicationId, which can't have hyphens.
const BUNDLE_ID = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

async function askName(question, fallback) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await prompt.question(`${question}: (${fallback}) `)
  prompt.close()

  return answer.trim() || fallback
}

// "My.Cool_App" -> "my-cool_app"
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
}

// "my-cool_app" -> "My Cool App"
function displayNameOf(slug) {
  return slug
    .split(/[-_]+/)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ')
}

function filesIn(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

function filled(text, values) {
  return Object.entries(values).reduce(
    (result, [placeholder, value]) => result.replaceAll(placeholder, value),
    text,
  )
}

/** In the files' text, and in their paths: template/package has __PASCAL__Plugin.swift. */
function fillPlaceholders(directory, values) {
  for (const file of filesIn(directory)) {
    if (TEXT_FILE.test(file)) {
      const source = readFileSync(file, 'utf8')
      const text = filled(source, values)

      if (text !== source) writeFileSync(file, text)
    }

    const path = filled(relative(directory, file), values)

    if (path === relative(directory, file)) continue

    mkdirSync(dirname(join(directory, path)), { recursive: true })
    renameSync(file, join(directory, path))
  }
  removeEmptyFolders(directory)
}

function removeEmptyFolders(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    const path = join(directory, entry.name)

    removeEmptyFolders(path)
    if (readdirSync(path).length === 0) rmSync(path, { recursive: true })
  }
}

/** Copies a template into a new folder, which may exist only if empty. */
function copyTemplate(template, directory) {
  if (existsSync(directory) && readdirSync(directory).length > 0) {
    fail(`${directory} already exists and isn't empty.`)
  }

  cpSync(template, directory, { recursive: true })
  // npm drops .gitignore files from published packages, so the templates ship it without the dot.
  renameSync(join(directory, 'gitignore'), join(directory, '.gitignore'))
}

// aapt2 and Kotlin refuse them as package names.
const KOTLIN_KEYWORDS = new Set(
  `abstract as assert boolean break byte case catch char class const continue default do double else
  enum extends false final finally float for fun goto if implements import in instanceof int interface
  is long native new null object package private protected public return short static strictfp super
  switch synchronized this throw throws transient true try typealias typeof val var void volatile when
  while`.split(/\s+/),
)

/**
 * From the whole name, like the linker's Swift module, so two packages never share a class:
 * "@acme/battery-level" -> AcmeBatteryLevelPlugin, acmeBatteryLevel.hello, acme.batterylevel.
 */
function moduleNames(packageName) {
  const words = packageName.split(/[^a-zA-Z0-9]+/).filter(Boolean)
  const joined = words.map((word) => word[0].toUpperCase() + word.slice(1)).join('')
  // Swift and Kotlin names start with a letter.
  const pascal = /^\d/.test(joined) ? `Module${joined}` : joined
  const scope = packageName.startsWith('@') ? words[0] : 'nativue'
  const name = packageName.startsWith('@') ? words.slice(1) : words
  const kotlinPackage = [scope, name.join('')]
    .map((part) => part.toLowerCase())
    .map((part) => (/^\d/.test(part) || KOTLIN_KEYWORDS.has(part) ? `module${part}` : part))
    .join('.')

  return { pascal, camel: pascal[0].toLowerCase() + pascal.slice(1), kotlinPackage }
}

function createPackage(packageName) {
  if (!PACKAGE_NAME.test(packageName))
    fail(`"${packageName}" isn't a valid npm package name, e.g. nativue-battery`)

  const directory = resolve(basename(packageName))
  const path = relative(process.cwd(), directory) || '.'
  const { pascal, camel, kotlinPackage } = moduleNames(packageName)

  if (!pascal) fail('The package name needs at least one letter or digit.')
  // nativue's own: its Swift module, Gradle project and NativuePlugin protocol.
  if (pascal === 'Nativue')
    fail(`"${packageName}" is nativue's own name: add a word, e.g. nativue-battery`)

  copyTemplate(PACKAGE_TEMPLATE, directory)
  fillPlaceholders(directory, {
    __PACKAGE_NAME__: packageName,
    __NAME__: basename(packageName),
    __PASCAL__: pascal,
    __MODULE__: camel,
    __KOTLIN_PACKAGE__: kotlinPackage,
    __KOTLIN_PATH__: kotlinPackage.replaceAll('.', '/'),
    __NATIVUE_VERSION__: version,
  })

  console.log(`
Created ${packageName} in ${path}

  cd ${path}
  npm install

  Try it in an app: npm install ${directory} from the app, then npm run ios or npm run android
  Its native side: ios/${pascal}Plugin.swift and android/src/main/java/${kotlinPackage.replaceAll('.', '/')}/${pascal}Plugin.kt
`)
}

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: { 'bundle-id': { type: 'string' }, module: { type: 'boolean' } },
})

if (options.module && options['bundle-id']) {
  fail('--bundle-id is for an app; a package gets its names from the package name.')
}

if (options.module)
  createPackage(positionals[0] ?? (await askName('Package name', 'nativue-my-module')))
else await createApp(positionals[0] ?? (await askName('Project name', 'my-app')))

async function createApp(projectName) {
  if (/\s/.test(projectName)) {
    fail(`"${projectName}" has spaces: use dashes or underscores instead, e.g. my-app or my_app`)
  }

  const projectDirectory = resolve(projectName)
  const projectPath = relative(process.cwd(), projectDirectory) || '.'
  const slug = slugify(basename(projectDirectory))
  // Bundle ids and URL schemes allow neither dashes nor underscores here, and start with a letter.
  const urlScheme = slug.replace(/[-_]/g, '').replace(/^(?=\d)/, 'app')
  const bundleId = options['bundle-id'] ?? `com.example.${urlScheme}`

  if (!slug) fail('The project name needs at least one letter or digit.')
  if (!BUNDLE_ID.test(bundleId))
    fail(`"${bundleId}" is not a valid bundle id, e.g. com.company.app`)

  copyTemplate(APP_TEMPLATE, projectDirectory)
  fillPlaceholders(projectDirectory, {
    __PACKAGE_NAME__: slug,
    __DISPLAY_NAME__: displayNameOf(slug),
    __BUNDLE_ID__: bundleId,
    __URL_SCHEME__: urlScheme,
    __NATIVUE_VERSION__: `^${version}`,
  })

  console.log(`
Created ${displayNameOf(slug)} in ${projectPath}

  cd ${projectPath}
  npm install
  npm run ios                 or npm run android: opens the app on a simulator or emulator, then
                              keeps running, rebuilding and reloading the app on save

  On your phone: run npx nativue prebuild, open ios/App.xcodeproj in Xcode, or the android folder
  in Android Studio, and press Run, with npm run dev running

Bundle id: ${bundleId} (set it with --bundle-id, or later in nativue.config.ts)
`)
}
