// Config plugins' mods: functions a package (its package.json's "nativue": { "plugin": "./plugin.mjs" })
// or the app (nativue.config.ts's `plugins`) runs on the native files prebuild generates, before the
// app's own fields, so the app always wins.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { appResources, emptyGradle, iosFonts, resourceFile } from './app-config.mjs'
import { nativuePackages, toPosixPath } from './link.mjs'
import { escapeXml } from './serialize.mjs'

// Where an app with `prebuild: false` keeps no file of its own; skipped when walking.
const SKIPPED_DIRECTORIES = new Set(['build', 'node_modules', 'NativuePlugins', '.gradle', 'Pods'])

/**
 * The plugins prebuild applies: each package's own, without options, then nativue.config.ts's. A
 * package's plugin is named after the package, so a config plugin of that name replaces it before
 * it's created: a plugin with required options works.
 */
export async function resolvePlugins(appDirectory, configPlugins = []) {
  const configured = new Set(configPlugins.map((plugin) => plugin.name))
  const packages = nativuePackages(appDirectory).filter(
    ({ name, nativue }) => nativue.plugin && !configured.has(name),
  )
  const packagePlugins = await Promise.all(packages.map(loadPackagePlugin))

  return [...packagePlugins, ...configPlugins]
}

async function loadPackagePlugin({ name, directory, nativue }) {
  const path = join(directory, nativue.plugin)
  const { default: createPlugin } = await import(pathToFileURL(path).href)
  const plugin = typeof createPlugin === 'function' ? await createPlugin() : null

  if (plugin?.name !== name) {
    throw new Error(
      `${name}'s nativue plugin (${path}) must export by default a function returning { name: '${name}', ... }`,
    )
  }

  return plugin
}

/** Runs every plugin's mod on document, in order; mods change it in place. */
export function applyMods(plugins, platform, mod, document, context) {
  plugins.forEach((plugin) => {
    try {
      plugin[platform]?.[mod]?.(document, { ...context, platform })
    } catch (error) {
      throw new Error(`${plugin.name}'s ${platform}.${mod} mod failed: ${error.message}`, {
        cause: error,
      })
    }
  })

  return document
}

function filesIn(directory) {
  if (!existsSync(directory)) return []

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)

    if (entry.isDirectory()) return SKIPPED_DIRECTORIES.has(entry.name) ? [] : filesIn(path)

    return [toPosixPath(path)]
  })
}

function stringValues(value) {
  if (typeof value === 'string') return [value]
  if (typeof value !== 'object' || value === null) return []

  return Object.values(value).flatMap(stringValues)
}

/** Each key a mod adds, present with every string of its value. */
function plistChecks(file, document) {
  return Object.entries(document).map(([key, value]) => {
    const parts = [
      `<key>${escapeXml(key)}</key>`,
      ...stringValues(value).map((text) => `<string>${escapeXml(text)}</string>`),
    ]

    return {
      file,
      entry: `<key>${key}</key> = ${JSON.stringify(value)}`,
      isPresent: (text) => parts.every((part) => text.includes(part)),
    }
  })
}

function usesPermissions(element) {
  const own = element.tag === 'uses-permission' ? [element.attributes['android:name']] : []

  return [...own, ...(element.children ?? []).flatMap(usesPermissions)]
}

function isQuoted(content, text) {
  return content.includes(`"${text}"`) || content.includes(`'${text}'`)
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Kotlin or Groovy, either quotes; a dependency at any version. */
function gradleChecks(gradle) {
  const inGradle = (entry, isPresent) => ({ file: 'build.gradle.kts', entry, isPresent })

  return [
    ...gradle.plugins.map(({ id }) => inGradle(`id("${id}")`, (content) => isQuoted(content, id))),
    ...gradle.dependencies.map((dependency) => {
      const groupAndArtifact = dependency.split(':').slice(0, 2).join(':')

      return inGradle(`implementation("${dependency}")`, (content) =>
        content.includes(groupAndArtifact),
      )
    }),
    ...gradle.repositories.map((url) =>
      inGradle(`maven("${url}")`, (content) => content.includes(url)),
    ),
    ...Object.entries(gradle.manifestPlaceholders).map(([key, value]) =>
      inGradle(`manifestPlaceholders["${key}"] = "${value}"`, (content) =>
        new RegExp(`\\b${escapeRegExp(key)}\\b`).test(content),
      ),
    ),
    ...Object.entries(gradle.properties).map(([key, value]) => ({
      file: 'gradle.properties',
      entry: `${key}=${value}`,
      isPresent: (content) => new RegExp(`^\\s*${escapeRegExp(key)}\\s*[=:]`, 'm').test(content),
    })),
  ]
}

/** A plugin's resource, by the end of its path. */
function resourceCheck(file, path) {
  return { file, entry: path, isPresent: (filePath) => filePath.endsWith(`/${path}`) }
}

/** What one plugin's mods and resources add on a platform, as { file, entry, isPresent } checks. */
function pluginRequirements(plugin, platform, { context, manifest }) {
  const run = (mod, document) => applyMods([plugin], platform, mod, document, context)
  const resources = appResources({}, [plugin])
  const fonts = iosFonts(resources)

  if (platform === 'ios') {
    // An invalid target is only refused when generating: here, it's skipped.
    const targetNames = run('targets', [])
      .map((target) => target?.name)
      .filter((name) => typeof name === 'string')

    return [
      ...targetNames.map((name) => ({
        file: 'project.pbxproj',
        entry: `an extension target named ${name}`,
        isPresent: (text) =>
          new RegExp(`isa = PBXNativeTarget;[^}]*\\bname = "?${name}"?;`).test(text),
      })),
      ...plistChecks('Info.plist', run('infoPlist', {})),
      ...plistChecks('.entitlements', run('entitlements', {})),
      ...plistChecks('Info.plist', fonts.length > 0 ? { UIAppFonts: fonts } : {}),
      ...resources
        .filter(({ ios }) => ios)
        .map(({ ios }) => resourceCheck('ios resources', ios.destination)),
    ]
  }

  const gradle = run('gradle', emptyGradle())

  const basePermissions = usesPermissions(manifest)
  const addedPermissions = usesPermissions(run('manifest', structuredClone(manifest))).filter(
    (permission) => !basePermissions.includes(permission),
  )

  return [
    ...addedPermissions.map((permission) => ({
      file: 'AndroidManifest.xml',
      entry: `<uses-permission android:name="${permission}" />`,
      isPresent: (text) => text.includes(`"${permission}"`),
    })),
    ...Object.entries(run('strings', {})).map(([name, value]) => ({
      file: 'res/values strings',
      entry: `<string name="${name}">${value}</string>`,
      isPresent: (text) => text.includes(`name="${name}"`),
    })),
    ...gradleChecks(gradle),
    ...resources
      .filter(({ android }) => android)
      .map((resource) => resourceCheck('android resources', resourceFile(resource))),
  ]
}

/** By check: the texts of the app's files it looks in, or their paths for resources. */
function projectFiles(appDirectory) {
  const iosPaths = filesIn(join(appDirectory, 'ios'))
  const androidPaths = filesIn(join(appDirectory, 'android'))
  const texts = (paths, matches) =>
    paths.filter((path) => matches(basename(path))).map((path) => readFileSync(path, 'utf8'))

  return {
    'Info.plist': texts(iosPaths, (name) => name.endsWith('Info.plist')),
    '.entitlements': texts(iosPaths, (name) => name.endsWith('.entitlements')),
    'ios resources': iosPaths,
    'project.pbxproj': texts(iosPaths, (name) => name === 'project.pbxproj'),
    'AndroidManifest.xml': texts(androidPaths, (name) => name === 'AndroidManifest.xml'),
    'res/values strings': texts(androidPaths, (name) => /^strings.*\.xml$/.test(name)),
    'build.gradle.kts': texts(androidPaths, (name) => /\.gradle(\.kts)?$/.test(name)),
    'gradle.properties': texts(androidPaths, (name) => name === 'gradle.properties'),
    'android resources': androidPaths,
  }
}

/**
 * With `prebuild: false`, the app's own ios/ and android/ must hold what its plugins' mods add:
 * throws with what's missing, to paste in. Only the platforms built that the app has are checked.
 * manifest: the generated manifest mods start from, so only what they add is asked for.
 */
export function checkManualProjects(plugins, { config, appDirectory, platforms, manifest }) {
  const checkedPlatforms = platforms.filter((platform) => existsSync(join(appDirectory, platform)))
  const files = projectFiles(appDirectory)
  const context = { config, projectRoot: appDirectory }
  const missing = checkedPlatforms.flatMap((platform) =>
    plugins.flatMap((plugin) =>
      pluginRequirements(plugin, platform, { context, manifest })
        .filter(({ file, isPresent }) => !files[file].some(isPresent))
        .map(({ file, entry }) => `  ${file}: ${entry} (from ${plugin.name})`),
    ),
  )

  if (missing.length === 0) return

  throw new Error(
    `nativue.config.ts has prebuild: false, so ios/ and android/ are yours, but they lack what these plugins need:\n${missing.join('\n')}`,
  )
}
