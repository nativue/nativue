// Links the iOS side of the app's packages: those whose package.json has
//   "nativue": { "ios": { "sources": "ios", "plugin": "HapticsPlugin" } }
// ios/NativuePlugins becomes a Swift package with a target per package (a link to its sources) and
// `nativuePlugins`, the list App.swift passes to NativueView. The app's Xcode project depends on it
// alone; it re-exports Nativue. (Android finds them itself: android/nativue.settings.gradle.kts.)
// The app's own native code links the same way: native/<name>/ios, whose plugin is <Name>Plugin.
// Swift packages the native code uses are listed in "ios": { "dependencies": [...] }, in the
// package.json's "nativue" field or native/<name>/nativue.json:
//   { "url": "https://github.com/stripe/stripe-ios-spm", "from": "24.0.0", "products": ["StripePaymentSheet"] }
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const PLUGINS_DIRECTORY = 'ios/NativuePlugins'
const SOURCES_DIRECTORY = `${PLUGINS_DIRECTORY}/Sources`
const LIST_TARGET = 'NativuePlugins'
const APP_NATIVE_DIRECTORY = 'native'

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** node_modules/<name>, looked up the way Node does: in the app's folder, then in its parents. */
function packageDirectory(name) {
  for (let directory = process.cwd(); ; directory = dirname(directory)) {
    const candidate = join(directory, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    if (directory === dirname(directory)) return null
  }
}

/** '@nativue/haptics' -> 'NativueHaptics', the Swift module of its sources. */
function moduleName(packageName) {
  return packageName
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('')
}

function iosPlugins() {
  const { dependencies = {}, devDependencies = {} } = readJson('package.json')
  const names = [...Object.keys(dependencies), ...Object.keys(devDependencies)]

  return names.flatMap((name) => {
    const directory = packageDirectory(name)
    const ios = directory && readJson(join(directory, 'package.json')).nativue?.ios
    if (!ios) return []

    return [
      {
        module: moduleName(name),
        sources: join(directory, ios.sources),
        plugin: ios.plugin,
        dependencies: ios.dependencies ?? [],
      },
    ]
  })
}

/** native/<name>/ios: module App<Name> (not <Name>, which could hide a system module like Photos). */
function appPlugins() {
  if (!existsSync(APP_NATIVE_DIRECTORY)) return []

  return readdirSync(APP_NATIVE_DIRECTORY).flatMap((name) => {
    const sources = resolve(APP_NATIVE_DIRECTORY, name, 'ios')
    if (!existsSync(sources)) return []

    const settingsPath = join(APP_NATIVE_DIRECTORY, name, 'nativue.json')
    const settings = existsSync(settingsPath) ? readJson(settingsPath) : {}

    return [
      {
        module: `App${moduleName(name)}`,
        sources,
        plugin: `${moduleName(name)}Plugin`,
        dependencies: settings.ios?.dependencies ?? [],
      },
    ]
  })
}

function writeIfChanged(path, content) {
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return

  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/** Sources/<module> -> the package's sources; links of packages the app no longer has are removed. */
function linkSources(plugins) {
  const linkTargets = new Map(
    plugins.map((plugin) => [plugin.module, relative(SOURCES_DIRECTORY, plugin.sources)]),
  )
  mkdirSync(SOURCES_DIRECTORY, { recursive: true })

  for (const entry of readdirSync(SOURCES_DIRECTORY)) {
    if (entry !== LIST_TARGET && !linkTargets.has(entry)) rmSync(join(SOURCES_DIRECTORY, entry))
  }

  for (const [module, target] of linkTargets) {
    const link = join(SOURCES_DIRECTORY, module)
    if (existsSync(link) && readlinkSync(link) === target) continue

    rmSync(link, { force: true })
    symlinkSync(target, link)
  }
}

/** SwiftPM's identity of a package: the last part of its URL, without .git, lowercased. */
function packageIdentity(url) {
  return url
    .replace(/\.git$/, '')
    .split('/')
    .pop()
    .toLowerCase()
}

/** One `.package` per URL: the first plugin to list a package sets its version. */
function swiftPackages(plugins) {
  const versionsByUrl = new Map()
  plugins.forEach(({ dependencies }) =>
    dependencies.forEach(({ url, from }) => versionsByUrl.has(url) || versionsByUrl.set(url, from)),
  )

  return [...versionsByUrl].map(
    ([url, from]) => `        .package(url: "${url}", from: "${from}"),\n`,
  )
}

function packageManifest(plugins, corePath) {
  const nativue = '.product(name: "Nativue", package: "core")'
  const pluginTargets = plugins.map(({ module, dependencies }) => {
    const products = dependencies.flatMap(({ url, products }) =>
      products.map((product) => `.product(name: "${product}", package: "${packageIdentity(url)}")`),
    )
    const targetDependencies = [nativue, ...products].join(', ')

    return `        .target(name: "${module}", dependencies: [${targetDependencies}], path: "Sources/${module}"),\n`
  })
  const listDependencies = [nativue, ...plugins.map(({ module }) => `"${module}"`)].join(', ')

  return `// swift-tools-version: 5.9
// Generated by nativue from the app's packages (packages/core/cli/link.mjs): rewritten on every build.
import PackageDescription

let package = Package(
    name: "NativuePlugins",
    platforms: [.iOS(.v17)],
    products: [.library(name: "NativuePlugins", targets: ["${LIST_TARGET}"])],
    dependencies: [
        .package(path: "${corePath}"),
${swiftPackages(plugins).join('')}    ],
    targets: [
${pluginTargets.join('')}        .target(name: "${LIST_TARGET}", dependencies: [${listDependencies}], path: "Sources/${LIST_TARGET}"),
    ]
)
`
}

function pluginList(plugins) {
  const imports = plugins.map(({ module }) => `import ${module}\n`).join('')
  const instances = plugins.map(({ plugin }) => `${plugin}()`).join(', ')

  return `// Generated by nativue from the app's packages (packages/core/cli/link.mjs): rewritten on every build.
@_exported import Nativue
${imports}
public let nativuePlugins: [NativuePlugin] = [${instances}]
`
}

/** coreDirectory: @nativue/core's folder, which holds its Package.swift. */
export function linkIosPlugins(coreDirectory) {
  if (!existsSync('ios') || !existsSync('package.json')) return

  const plugins = [...iosPlugins(), ...appPlugins()]
  const corePath = relative(resolve(PLUGINS_DIRECTORY), coreDirectory)

  linkSources(plugins)
  writeIfChanged(`${PLUGINS_DIRECTORY}/Package.swift`, packageManifest(plugins, corePath))
  writeIfChanged(`${SOURCES_DIRECTORY}/${LIST_TARGET}/Plugins.swift`, pluginList(plugins))
}
