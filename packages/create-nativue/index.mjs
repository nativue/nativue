#!/usr/bin/env node
// npm create nativue@latest my-app [-- --bundle-id com.company.myapp]
// Copies template/ into a new folder and fills in the app's names.
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const TEMPLATE_DIRECTORY = fileURLToPath(new URL('./template', import.meta.url))
const TEXT_FILE = /(\.(json|vue|ts|plist|pbxproj|resolved|swift|kt|kts|xml|md)|gitignore)$/
// Also the Android package and applicationId, which can't have hyphens.
const BUNDLE_ID = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

async function askProjectName() {
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await prompt.question('Project name: (my-app) ')
  prompt.close()

  return answer.trim() || 'my-app'
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

function fillPlaceholders(directory, values) {
  for (const file of filesIn(directory).filter((path) => TEXT_FILE.test(path))) {
    const source = readFileSync(file, 'utf8')
    const filled = Object.entries(values).reduce(
      (text, [placeholder, value]) => text.replaceAll(placeholder, value),
      source,
    )
    if (filled !== source) writeFileSync(file, filled)
  }
}

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: { 'bundle-id': { type: 'string' } },
})

const projectName = positionals[0] ?? (await askProjectName())
if (/\s/.test(projectName)) {
  fail(`"${projectName}" has spaces: use dashes or underscores instead, e.g. my-app or my_app`)
}

const projectDirectory = resolve(projectName)
const projectPath = relative(process.cwd(), projectDirectory) || '.'
const slug = slugify(basename(projectDirectory))
// Bundle ids and URL schemes allow neither dashes nor underscores here.
const urlScheme = slug.replace(/[-_]/g, '')
const bundleId = options['bundle-id'] ?? `com.example.${urlScheme}`

if (!slug) fail('The project name needs at least one letter or digit.')
if (!BUNDLE_ID.test(bundleId)) fail(`"${bundleId}" is not a valid bundle id, e.g. com.company.app`)
if (existsSync(projectDirectory) && readdirSync(projectDirectory).length > 0) {
  fail(`${projectDirectory} already exists and isn't empty.`)
}

cpSync(TEMPLATE_DIRECTORY, projectDirectory, { recursive: true })
// npm drops .gitignore files from published packages, so the template ships it without the dot.
renameSync(join(projectDirectory, 'gitignore'), join(projectDirectory, '.gitignore'))
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

  On your phone: open ios/App.xcodeproj in Xcode, or the android folder in Android Studio, and
  press Run, with npm run dev running

Bundle id: ${bundleId} (set it with --bundle-id, or later in Xcode and android/app/build.gradle.kts)
`)
