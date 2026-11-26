// Config plugins' mods: functions a package (its package.json's "nativue": { "plugin": "./plugin.mjs" })
// or the app (nativue.config.ts's `plugins`) runs on the native files prebuild generates, before the
// app's own fields, so the app always wins.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { nativuePackages } from './link.mjs'
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

function textFiles(directory, matches) {
  if (!existsSync(directory)) return []

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)

    if (entry.isDirectory()) {
      return SKIPPED_DIRECTORIES.has(entry.name) ? [] : textFiles(path, matches)
    }

    return matches(entry.name) ? [readFileSync(path, 'utf8')] : []
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

/** What one plugin's mods add on a platform, as { file, entry, isPresent(text) } checks. */
function pluginRequirements(plugin, platform, { context, manifest }) {
  const run = (mod, document) => applyMods([plugin], platform, mod, document, context)

  if (platform === 'ios') {
    return [
      ...plistChecks('Info.plist', run('infoPlist', {})),
      ...plistChecks('.entitlements', run('entitlements', {})),
    ]
  }

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
  ]
}

function projectFiles(appDirectory) {
  const ios = (matches) => textFiles(join(appDirectory, 'ios'), matches)
  const android = (matches) => textFiles(join(appDirectory, 'android'), matches)

  return {
    'Info.plist': ios((name) => name.endsWith('Info.plist')),
    '.entitlements': ios((name) => name.endsWith('.entitlements')),
    'AndroidManifest.xml': android((name) => name === 'AndroidManifest.xml'),
    'res/values strings': android((name) => /^strings.*\.xml$/.test(name)),
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
