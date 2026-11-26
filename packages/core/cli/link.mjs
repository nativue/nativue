// The iOS side of the app's packages, those whose package.json has
//   "nativue": { "ios": { "sources": "ios", "plugin": "HapticsPlugin" } }
// for prebuild to write: ios/NativuePlugins, a Swift package with a target per package (a link to its
// sources) and `nativuePlugins`, the list App.swift passes to NativueView. The app's Xcode project
// depends on it alone; it re-exports Nativue. (Android finds them itself:
// android/nativue.settings.gradle.kts.)
// The app's own native code links the same way: native/<name>/ios, whose plugin is <Name>Plugin.
// Swift packages the native code uses are listed in "ios": { "dependencies": [...] }, in the
// package.json's "nativue" field or native/<name>/nativue.json:
//   { "url": "https://github.com/stripe/stripe-ios-spm", "from": "24.0.0", "products": ["StripePaymentSheet"] }
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

const PLUGINS_DIRECTORY = 'NativuePlugins'
const LIST_TARGET = 'NativuePlugins'

/** Paths in generated files, links and prebuild's records use '/', on Windows too. */
export function toPosixPath(path) {
  return path.split(sep).join('/')
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** node_modules/<name>, looked up the way Node does: in the app's folder, then in its parents. */
function packageDirectory(name, appDirectory) {
  for (let directory = appDirectory; ; directory = dirname(directory)) {
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

/** The app's packages with a "nativue" field in their package.json, in the order it lists them. */
export function nativuePackages(appDirectory) {
  if (!existsSync(join(appDirectory, 'package.json'))) return []

  const { dependencies = {}, devDependencies = {} } = readJson(join(appDirectory, 'package.json'))
  const names = new Set([...Object.keys(dependencies), ...Object.keys(devDependencies)])

  return [...names].flatMap((name) => {
    const directory = packageDirectory(name, appDirectory)
    const nativue = directory && readJson(join(directory, 'package.json')).nativue

    return nativue ? [{ name, directory, nativue }] : []
  })
}

function iosPlugins(appDirectory) {
  return nativuePackages(appDirectory).flatMap(({ name, directory, nativue }) => {
    const ios = nativue.ios
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
function appPlugins(appDirectory) {
  const nativeDirectory = join(appDirectory, 'native')
  if (!existsSync(nativeDirectory)) return []

  return readdirSync(nativeDirectory).flatMap((name) => {
    const sources = join(nativeDirectory, name, 'ios')
    if (!existsSync(sources)) return []

    const settingsPath = join(nativeDirectory, name, 'nativue.json')
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
// Generated by nativue prebuild from the app's packages: rewritten on every build.
import PackageDescription

let package = Package(
    name: "NativuePlugins",
    platforms: [.iOS("15.1")],
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

  return `// Generated by nativue prebuild from the app's packages: rewritten on every build.
@_exported import Nativue
${imports}
public let nativuePlugins: [NativuePlugin] = [${instances}]
`
}

/**
 * ios/NativuePlugins, as prebuild entries by path relative to ios/: its Package.swift, the plugin
 * list and, per package, a link to its sources. coreDirectory: @nativue/core's folder, which holds
 * its Package.swift.
 */
export function iosPluginFiles(appDirectory, coreDirectory) {
  const plugins = [...iosPlugins(appDirectory), ...appPlugins(appDirectory)]
  const pluginsDirectory = join(appDirectory, 'ios', PLUGINS_DIRECTORY)
  const sourcesDirectory = join(pluginsDirectory, 'Sources')
  const links = plugins.map(({ module, sources }) => [
    `${PLUGINS_DIRECTORY}/Sources/${module}`,
    { symlink: toPosixPath(relative(sourcesDirectory, sources)) },
  ])

  return {
    [`${PLUGINS_DIRECTORY}/Package.swift`]: packageManifest(
      plugins,
      toPosixPath(relative(pluginsDirectory, coreDirectory)),
    ),
    [`${PLUGINS_DIRECTORY}/Sources/${LIST_TARGET}/Plugins.swift`]: pluginList(plugins),
    ...Object.fromEntries(links),
  }
}
