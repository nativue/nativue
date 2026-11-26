// `nativue prebuild [ios | android] [--force]`, also run by dev, build and run: generates the app's
// ios/ and android/ from the template next to this file, nativue.config.ts and the app's packages.
// Every run starts from the template, so the projects depend only on those inputs; it writes only
// what changed, keeping Xcode's and Gradle's incremental builds.
// Each folder's .nativue/generated.json records a hash of every file it wrote. A file that no longer
// matches was edited by hand, and one it never wrote was added by hand: either stops prebuild before
// it writes anything, since the next run would lose that work. --force overwrites and deletes them.
// With `prebuild: false` in the config, the app keeps ios/ and android/ by hand: only the packages'
// native code is linked (ios/NativuePlugins), as before prebuild existed.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { androidProjectFiles, nativueManifest } from './android-project.mjs'
import { appConfig, validateConfig } from './app-config.mjs'
import { iosProjectFiles } from './ios-project.mjs'
import { iosPluginFiles, toPosixPath } from './link.mjs'
import { checkManualProjects } from './plugins.mjs'

export const PLATFORMS = ['ios', 'android']

const RECORD_PATH = '.nativue/generated.json'
const MIGRATION_GUIDE_URL =
  'https://github.com/nativue/nativue/blob/main/docs/migrating-to-prebuild.md'
const TEMPLATE_TEXT_FILE = /\.(kts|kt|xml|swift|json)$/
// What Xcode, Gradle, Android Studio and the bundler write next to the generated files: never
// checked, deleted or walked into.
const IGNORED_DIRECTORIES = new Set([
  'build',
  '.build',
  '.gradle',
  '.kotlin',
  '.cxx',
  '.idea',
  '.swiftpm',
  '.nativue',
  'xcuserdata',
])
const IGNORED_FILES = new Set(['.DS_Store', 'local.properties', 'main.bundle.js'])
const IGNORED_PATHS = new Set(['App.xcodeproj/project.xcworkspace'])
// Written only when missing: Xcode keeps the resolved Swift package versions up to date afterwards.
const SEEDED_PATHS = new Set([
  'App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved',
])

function isIgnored(path) {
  const name = path.split('/').pop()

  return (
    IGNORED_DIRECTORIES.has(name) ||
    IGNORED_FILES.has(name) ||
    IGNORED_PATHS.has(path) ||
    name.endsWith('.iml')
  )
}

function hash(data) {
  return createHash('sha256').update(data).digest('hex')
}

function entryHash(entry) {
  return entry.symlink === undefined ? hash(entry.content) : hash(`symlink:${entry.symlink}`)
}

/** Files and links under directory, by path relative to it, skipping what tools own. */
function filesIn(directory, base = directory) {
  if (!existsSync(directory)) return []

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    const relativePath = toPosixPath(relative(base, path))

    if (isIgnored(relativePath)) return []

    return entry.isDirectory() ? filesIn(path, base) : [relativePath]
  })
}

function readEntry(path) {
  if (lstatSync(path).isSymbolicLink()) return { symlink: readlinkSync(path) }

  return { content: readFileSync(path) }
}

function readRecord(platformDirectory) {
  const path = join(platformDirectory, RECORD_PATH)

  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}

function writeRecord(platformDirectory, record) {
  const path = join(platformDirectory, RECORD_PATH)

  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`)
}

function fillPlaceholders(text, values) {
  return Object.entries(values).reduce(
    (filled, [placeholder, value]) => filled.replaceAll(placeholder, value),
    text,
  )
}

/** All of the template, including the seeded files under the paths isIgnored skips in the app. */
function templatePaths(templateDirectory) {
  return readdirSync(templateDirectory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== '.DS_Store')
    .map((entry) => toPosixPath(relative(templateDirectory, join(entry.parentPath, entry.name))))
}

function templateFiles(templateDirectory, placeholders) {
  return Object.fromEntries(
    templatePaths(templateDirectory).map((path) => {
      const source = join(templateDirectory, path)
      const content = readFileSync(source)
      const executable = (lstatSync(source).mode & 0o111) !== 0
      const filled = TEMPLATE_TEXT_FILE.test(path)
        ? fillPlaceholders(content.toString('utf8'), placeholders)
        : content

      return [path, { content: filled, executable }]
    }),
  )
}

function asEntries(files) {
  return Object.fromEntries(
    Object.entries(files).map(([path, file]) => [
      path,
      typeof file === 'string' ? { content: file } : file,
    ]),
  )
}

/** Every file of platform's folder, by path relative to it: { content, executable } or { symlink }. */
function generatedFiles(platform, { app, plugins, appDirectory, coreDirectory }) {
  const platformDirectory = join(appDirectory, platform)
  const placeholders = {
    __ANDROID_PACKAGE__: app.android.package,
    __CORE_PATH__: toPosixPath(relative(platformDirectory, coreDirectory)),
    __SPLASH_BACKGROUND__: app.splash.backgroundColor,
    __DARK_SPLASH_BACKGROUND__: app.splash.darkBackgroundColor,
    __ICON_BACKGROUND__: app.iconBackgroundColor,
  }
  const template = templateFiles(join(coreDirectory, 'template', platform), placeholders)
  const generated =
    platform === 'ios'
      ? {
          ...iosProjectFiles(app, appDirectory, plugins),
          ...iosPluginFiles(appDirectory, coreDirectory),
        }
      : androidProjectFiles(app, { appDirectory, corePath: placeholders.__CORE_PATH__, plugins })
  const files = { ...template, ...generated }

  // A null replaces a template file with nothing.
  return asEntries(Object.fromEntries(Object.entries(files).filter(([, file]) => file !== null)))
}

/** What the folder holds that prebuild didn't write, or wrote and was changed since. */
function findManualChanges(existingPaths, record, platformDirectory) {
  if (existingPaths.length > 0 && !record) return { notGenerated: true, edited: [], added: [] }

  const recordedHashes = { ...record?.pending, ...record?.files }
  const isRecorded = (path) => path in recordedHashes
  const matchesRecord = (path) => {
    const current = entryHash(readEntry(join(platformDirectory, path)))

    return current === record.files?.[path] || current === record.pending?.[path]
  }
  const edited = existingPaths.filter(
    (path) => isRecorded(path) && !SEEDED_PATHS.has(path) && !matchesRecord(path),
  )
  const added = existingPaths.filter((path) => !isRecorded(path) && !SEEDED_PATHS.has(path))

  return { notGenerated: false, edited, added }
}

function hasManualChanges({ notGenerated, edited, added }) {
  return notGenerated || edited.length > 0 || added.length > 0
}

/** git's diff of the file on disk (label) against what prebuild generates, or nothing without git. */
function diffAgainstGenerated(path, label, entry) {
  if (entry?.content === undefined) return ''

  const directory = mkdtempSync(join(tmpdir(), 'nativue-prebuild-'))
  const generatedPath = join(directory, 'generated')

  writeFileSync(generatedPath, entry.content)

  const { stdout } = spawnSync(
    'git',
    ['diff', '--no-index', '--no-prefix', '--color=always', '--', generatedPath, path],
    { encoding: 'utf8' },
  )
  rmSync(directory, { recursive: true, force: true })

  // Without a prefix, git prints absolute paths without their leading slash.
  return (stdout ?? '')
    .replaceAll(generatedPath.slice(1), `${label} (generated)`)
    .replaceAll(path.slice(1), `${label} (yours)`)
}

// Where a hand edit of each generated file belongs instead.
const DESTINATIONS = [
  [/^Info\.plist$/, 'ios.infoPlist in nativue.config.ts'],
  [/^App\.entitlements$/, 'ios.entitlements in nativue.config.ts'],
  [
    /^App\.xcodeproj\//,
    'nativue.config.ts: version, buildNumber, ios.appleTeamId, ios.entitlements',
  ],
  [/^App\/Assets\.xcassets\//, 'icon or splash in nativue.config.ts'],
  [
    /^app\/src\/main\/AndroidManifest\.xml$/,
    'android.permissions, or a plugin with an android.manifest mod (docs/packages.md)',
  ],
  [
    /^app\/build\.gradle\.kts$/,
    'nativue.config.ts: version, buildNumber, android.signing, android.gradle',
  ],
  [
    /^(build\.gradle\.kts|settings\.gradle\.kts|gradle\.properties)$/,
    'android.gradle in nativue.config.ts',
  ],
  [/^app\/src\/main\/res\/values\/strings\.xml$/, 'name in nativue.config.ts'],
  [
    /^app\/src\/main\/res\/values(-night)?\/(styles|colors)\.xml$/,
    'splash or android.adaptiveIcon.backgroundColor in nativue.config.ts',
  ],
  [
    /^app\/src\/main\/res\/(mipmap|drawable)/,
    'icon, android.adaptiveIcon or splash in nativue.config.ts',
  ],
  [
    /^(Extensions|ExtensionSupport)\//,
    "an extension target: native/extensions/<name>/, or a plugin's ios.targets mod",
  ],
  [/\.(swift|kt|java)$/, 'a module in native/<name>/'],
  [
    /^(App\/Resources\/|app\/src\/main\/(assets\/|res\/(raw|font|xml|drawable)\/))/,
    'resources in nativue.config.ts',
  ],
]

function destination(path) {
  const match = DESTINATIONS.find(([pattern]) => pattern.test(path))

  return match ? `  → ${match[1]}` : ''
}

/** For a team picked in Xcode, the config field that keeps it. */
function teamHint(path, platformDirectory) {
  if (!path.endsWith('project.pbxproj')) return ''

  const team = readFileSync(join(platformDirectory, path), 'utf8').match(
    /DEVELOPMENT_TEAM = "?(\w+)"?;/,
  )?.[1]

  return team ? `\nThe signing team goes in nativue.config.ts: ios: { appleTeamId: '${team}' }` : ''
}

function notGeneratedMessage(platforms) {
  const folders = platforms.map((platform) => `${platform}/`).join(' and ')
  const verb = platforms.length > 1 ? "weren't" : "wasn't"

  return `${folders} ${verb} generated by nativue: from before nativue generated the native projects, so nativue left them alone.
Move its settings into nativue.config.ts and let nativue generate it: ${MIGRATION_GUIDE_URL}
Or keep it by hand, with this nativue.config.ts:

  import { defineConfig } from '@nativue/core/config'

  export default defineConfig({ prebuild: false })`
}

function manualChangesMessage(platform, changes, files, appDirectory) {
  const platformDirectory = join(appDirectory, platform)

  const diffs = changes.edited.map(
    (path) =>
      diffAgainstGenerated(join(platformDirectory, path), `${platform}/${path}`, files[path]) +
      teamHint(path, platformDirectory),
  )
  const lines = [
    ...changes.edited.map((path) => `  changed: ${platform}/${path}${destination(path)}`),
    ...changes.added.map((path) => `  added:   ${platform}/${path}${destination(path)}`),
  ]

  return `${platform}/ is generated by nativue, but was changed by hand: the next prebuild would lose this.
${lines.join('\n')}
${diffs.filter(Boolean).join('\n')}
Move these changes into nativue.config.ts or native/, or keep ios/ and android/ by hand with
prebuild: false in nativue.config.ts (${MIGRATION_GUIDE_URL}).
To discard them instead: npx nativue prebuild --force`
}

function writeEntry(path, entry) {
  mkdirSync(dirname(path), { recursive: true })
  rmSync(path, { recursive: true, force: true })

  if (entry.symlink !== undefined) {
    symlinkSync(entry.symlink, path)
    return
  }

  writeFileSync(path, entry.content, { mode: entry.executable ? 0o755 : 0o644 })
}

/** Removes the folders that deleting path left empty, up to the platform folder. */
function removeEmptyParents(path, platformDirectory) {
  for (
    let directory = dirname(path);
    directory !== platformDirectory;
    directory = dirname(directory)
  ) {
    if (readdirSync(directory).length > 0) return

    rmdirSync(directory)
  }
}

/** Writes what changed and deletes what prebuild no longer generates; returns the paths it touched. */
function writePlatform(platformDirectory, files, existingPaths, record, version) {
  const hashes = Object.fromEntries(
    Object.entries(files)
      .filter(([path]) => !SEEDED_PATHS.has(path))
      .map(([path, entry]) => [path, entryHash(entry)]),
  )
  const existingHashes = Object.fromEntries(
    existingPaths.map((path) => [path, entryHash(readEntry(join(platformDirectory, path)))]),
  )
  const isUpToDate = (path) =>
    SEEDED_PATHS.has(path)
      ? existsSync(join(platformDirectory, path))
      : existingHashes[path] === hashes[path]
  const changedPaths = Object.keys(files).filter((path) => !isUpToDate(path))
  const removedPaths = existingPaths.filter((path) => !(path in files))

  if (changedPaths.length === 0 && removedPaths.length === 0 && record?.version === version) {
    return []
  }

  // Saved first, with both sets of hashes: a prebuild that stops halfway isn't taken for manual edits.
  writeRecord(platformDirectory, { version, files: record?.files ?? {}, pending: hashes })
  // Removed first: a file may take the place of a folder that held removed files.
  removedPaths.forEach((path) => {
    rmSync(join(platformDirectory, path), { force: true })
    removeEmptyParents(join(platformDirectory, path), platformDirectory)
  })
  changedPaths.forEach((path) => writeEntry(join(platformDirectory, path), files[path]))
  writeRecord(platformDirectory, { version, files: hashes })

  return [...changedPaths, ...removedPaths]
}

/**
 * Generates platforms' folders in appDirectory. Throws, before writing anything, when one was
 * changed by hand, unless force. Returns the paths written or deleted, relative to appDirectory.
 */
export function prebuild({
  config,
  plugins = [],
  appDirectory,
  coreDirectory,
  platforms = PLATFORMS,
  force = false,
}) {
  // An app from before prebuild has no config for it yet: say why first, not which fields are missing.
  const handKept = platforms.filter((platform) => {
    const platformDirectory = join(appDirectory, platform)

    return filesIn(platformDirectory).length > 0 && !readRecord(platformDirectory)
  })

  if (handKept.length > 0 && !force) throw new Error(notGeneratedMessage(handKept))

  validateConfig(config, appDirectory, plugins)

  const app = appConfig(config)
  const { version } = JSON.parse(readFileSync(join(coreDirectory, 'package.json'), 'utf8'))
  const plans = platforms.map((platform) => {
    const platformDirectory = join(appDirectory, platform)
    const files = generatedFiles(platform, { app, plugins, appDirectory, coreDirectory })
    const existingPaths = filesIn(platformDirectory)
    const record = readRecord(platformDirectory)
    const changes = findManualChanges(existingPaths, record, platformDirectory)

    return { platform, platformDirectory, files, existingPaths, record, changes }
  })

  const blocked = plans.filter((plan) => hasManualChanges(plan.changes))
  if (blocked.length > 0 && !force) {
    const messages = blocked.map(({ platform, changes, files }) =>
      manualChangesMessage(platform, changes, files, appDirectory),
    )
    throw new Error(messages.join('\n\n'))
  }

  return plans.flatMap(({ platform, platformDirectory, files, existingPaths, record }) =>
    writePlatform(platformDirectory, files, existingPaths, record, version).map(
      (path) => `${platform}/${path}`,
    ),
  )
}

/**
 * With `prebuild: false`: only ios/NativuePlugins, the packages' native code, written into the app's
 * own ios/ when it has one, as before prebuild existed.
 */
export function linkNativePackages({
  config,
  plugins = [],
  appDirectory,
  coreDirectory,
  platforms = PLATFORMS,
}) {
  validateConfig(config, appDirectory)
  checkManualProjects(plugins, {
    config,
    appDirectory,
    platforms,
    manifest: nativueManifest({ schemes: [] }),
  })

  const iosDirectory = join(appDirectory, 'ios')
  if (!existsSync(iosDirectory)) return []

  const files = asEntries(iosPluginFiles(appDirectory, coreDirectory))
  const isCurrent = (path) =>
    lstatSync(join(iosDirectory, path), { throwIfNoEntry: false }) &&
    entryHash(readEntry(join(iosDirectory, path))) === entryHash(files[path])
  const changedPaths = Object.keys(files).filter((path) => !isCurrent(path))
  // Links of packages the app no longer has.
  const modulePaths = filesIn(join(iosDirectory, 'NativuePlugins/Sources')).map(
    (path) => `NativuePlugins/Sources/${path.split('/')[0]}`,
  )
  const stalePaths = [...new Set(modulePaths)].filter(
    (path) => !Object.keys(files).some((file) => file.startsWith(path)),
  )

  changedPaths.forEach((path) => writeEntry(join(iosDirectory, path), files[path]))
  stalePaths.forEach((path) => rmSync(join(iosDirectory, path), { recursive: true, force: true }))

  return [...changedPaths, ...stalePaths].map((path) => `ios/${path}`)
}
