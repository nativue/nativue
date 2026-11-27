// nativue.config.ts as prebuild reads it: every problem at once, then the config with its defaults.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, extname, relative, resolve, sep } from 'node:path'

const IOS_BUNDLE_IDENTIFIER = /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/
const APPLE_TEAM_ID = /^[A-Z0-9]{10}$/
const ANDROID_PACKAGE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/
const ANDROID_PERMISSION = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/
const URL_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*$/
// CFBundleShortVersionString: "three period-separated integers".
const VERSION = /^\d+\.\d+\.\d+$/
// Google Play's greatest versionCode.
const MAXIMUM_BUILD_NUMBER = 2100000000
const COLOR = /^#[0-9a-fA-F]{6}$/
const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_.]*$/
const GRADLE_PROPERTY = /^[A-Za-z_][A-Za-z0-9_.-]*$/
// aapt2's rule for the files of res/: lowercase letters, digits and underscores.
const ANDROID_RESOURCE_NAME = /^[a-z][a-z0-9_]*$/
// aapt2 turns resource names into Java fields (R.raw.chime): it refuses Java's keywords.
const JAVA_KEYWORDS = new Set(
  `abstract assert boolean break byte case catch char class const continue default do double else enum
  extends false final finally float for goto if implements import instanceof int interface long native
  new null package private protected public return short static strictfp super switch synchronized this
  throw throws transient true try void volatile while`.split(/\s+/),
)

function isAndroidResourceName(name) {
  return ANDROID_RESOURCE_NAME.test(name) && !JAVA_KEYWORDS.has(name)
}
const ANDROID_RESOURCE_TYPES = ['raw', 'font', 'drawable', 'xml', 'assets']
const APP_GROUP = /^group\.[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*$/
const EXTENSION_NAME = /^[A-Za-z][A-Za-z0-9_]*$/
const BUNDLE_IDENTIFIER_SUFFIX = /^(\.[a-zA-Z0-9-]+)+$/
const DEPLOYMENT_TARGET = /^\d+\.\d+(\.\d+)?$/
/** An extension target's type, and the NSExtensionPointIdentifier iOS knows it by. */
export const EXTENSION_POINTS = {
  'notification-service': 'com.apple.usernotifications.service',
  'notification-content': 'com.apple.usernotifications.content-extension',
  widget: 'com.apple.widgetkit-extension',
  share: 'com.apple.share-services',
}
const PNG_SIGNATURE = '89504e470d0a1a0a'
// IHDR color types with an alpha channel: grayscale and RGB with alpha.
const PNG_ALPHA_COLOR_TYPES = new Set([4, 6])
// The logo shown on the launch screen: 120 points wide on iOS, as @3x.
const SPLASH_IMAGE_SIZE = 360
const ICON_SIZE = 1024

/** The fields only generated projects use, which `prebuild: false` can't have. */
const GENERATED_PROJECT_FIELDS = [
  'name',
  'scheme',
  'version',
  'buildNumber',
  'icon',
  'splash',
  'ios',
  'android',
  'resources',
]

const DEFAULTS = {
  version: '1.0.0',
  buildNumber: 1,
  splashBackgroundColor: '#FFFFFF',
  // Ink, from the template's own icon and splash.
  darkSplashBackgroundColor: '#0B1220',
  iconBackgroundColor: '#0B1220',
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPlistValue(value) {
  if (['string', 'number', 'boolean'].includes(typeof value)) return true
  if (Array.isArray(value)) return value.every(isPlistValue)

  return isObject(value) && Object.values(value).every(isPlistValue)
}

function plistProblem(field, value, example) {
  return check(
    value === undefined || (isObject(value) && isPlistValue(value)),
    `${field}: strings, numbers, booleans, lists and objects, e.g. ${example}`,
  )
}

/** A PNG's size and whether it has an alpha channel, or null for any other file. */
function pngHeader(data) {
  if (data.length < 26 || data.subarray(0, 8).toString('hex') !== PNG_SIGNATURE) return null

  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    hasAlpha: PNG_ALPHA_COLOR_TYPES.has(data[25]),
  }
}

function imageProblem(field, path, appDirectory, size, { opaque = false } = {}) {
  if (path === undefined) return null

  const expected = size ? `a ${size}×${size} PNG` : 'a square PNG'
  const fullPath = resolve(appDirectory, String(path))

  if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
    return `${field}: ${path} isn't a file (${expected}, relative to the app)`
  }

  const actual = pngHeader(readFileSync(fullPath))
  const fits =
    actual !== null &&
    actual.width === actual.height &&
    (size === undefined || actual.width === size)

  // The App Store rejects an app icon with an alpha channel.
  if (fits && opaque && actual.hasAlpha) {
    return `${field}: ${path} must have no transparency: export it without an alpha channel`
  }
  if (fits) return null

  const found = actual ? `${actual.width}×${actual.height}` : 'not a PNG'

  return `${field}: ${path} must be ${expected}, it's ${found}`
}

function check(isValid, problem) {
  return isValid ? null : problem
}

function colorProblem(field, value) {
  return check(value === undefined || COLOR.test(value), `${field}: a color like '#0B1220'`)
}

function schemeProblems(scheme) {
  const schemes = [scheme].flat()

  return check(
    schemes.length > 0 && schemes.every((each) => URL_SCHEME.test(each ?? '')),
    "scheme: e.g. scheme: 'myapp', for myapp:// links, or a list of them",
  )
}

/** ios/ and android/ are generated: prebuild --force would delete a keystore kept there. */
function isInGeneratedFolder(path, appDirectory) {
  const [folder] = relative(appDirectory, resolve(appDirectory, path)).split(sep)

  // macOS and Windows don't tell Android/ from android/.
  return ['ios', 'android'].includes(folder.toLowerCase())
}

function signingProblems(signing, appDirectory) {
  if (signing === undefined) return []

  return [
    check(
      typeof signing.storeFile === 'string' &&
        !isInGeneratedFolder(signing.storeFile, appDirectory),
      "android.signing.storeFile: the keystore, outside ios/ and android/, e.g. './credentials/upload.keystore'",
    ),
    check(typeof signing.keyAlias === 'string', "android.signing.keyAlias: e.g. 'upload'"),
    ...['storePasswordEnv', 'keyPasswordEnv'].map((field) =>
      check(
        SECRET_NAME.test(signing[field] ?? ''),
        `android.signing.${field}: the name of the environment variable or Gradle property holding it, e.g. 'ANDROID_STORE_PASSWORD'`,
      ),
    ),
  ]
}

function isStringList(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item !== '')
}

function isStringRecord(value, keyPattern = /./) {
  return (
    isObject(value) &&
    Object.entries(value).every(
      ([key, item]) => keyPattern.test(key) && typeof item === 'string' && !item.includes('\n'),
    )
  )
}

export function emptyGradle() {
  return {
    plugins: [],
    dependencies: [],
    manifestPlaceholders: {},
    repositories: [],
    properties: {},
  }
}

function isText(value) {
  return typeof value === 'string' && value !== '' && !value.includes('\n')
}

/** android.gradle, or what the plugins' gradle mods made (field: where it comes from). */
export function gradleProblems(gradle, field = 'android.gradle') {
  if (gradle === undefined) return []

  const { plugins, dependencies, repositories, manifestPlaceholders, properties } = gradle

  return [
    check(
      plugins === undefined ||
        (Array.isArray(plugins) &&
          plugins.every(
            (plugin) =>
              isText(plugin?.id) && (plugin.version === undefined || isText(plugin.version)),
          )),
      `${field}.plugins: e.g. [{ id: 'com.google.gms.google-services', version: '4.4.2' }]`,
    ),
    check(
      dependencies === undefined || (Array.isArray(dependencies) && dependencies.every(isText)),
      `${field}.dependencies: e.g. ['com.squareup.okhttp3:okhttp:4.12.0']`,
    ),
    check(
      repositories === undefined ||
        (Array.isArray(repositories) &&
          repositories.every((url) => isText(url) && url.startsWith('https://'))),
      `${field}.repositories: Maven URLs, e.g. ['https://jitpack.io']`,
    ),
    check(
      manifestPlaceholders === undefined || isStringRecord(manifestPlaceholders),
      `${field}.manifestPlaceholders: e.g. { appAuthRedirectScheme: 'myapp' }`,
    ),
    check(
      properties === undefined || isStringRecord(properties, GRADLE_PROPERTY),
      `${field}.properties: e.g. { 'android.enableJetifier': 'true' }`,
    ),
  ]
}

function isDirectory(path) {
  return existsSync(path) && statSync(path).isDirectory()
}

function extensionTargetProblems(target, field, { appDirectory, appGroups }) {
  const { sources } = target

  return [
    check(
      typeof sources === 'string' && isDirectory(resolve(appDirectory, sources)),
      `${field}.sources: the folder of the extension's Swift files`,
    ),
    check(
      Object.keys(EXTENSION_POINTS).includes(target.type),
      `${field}.type: one of ${Object.keys(EXTENSION_POINTS).join(', ')}`,
    ),
    check(
      BUNDLE_IDENTIFIER_SUFFIX.test(target.bundleIdSuffix ?? ''),
      `${field}.bundleIdSuffix: added to the app's bundle identifier, e.g. '.${target.name}'`,
    ),
    check(
      target.deploymentTarget === undefined || DEPLOYMENT_TARGET.test(target.deploymentTarget),
      `${field}.deploymentTarget: e.g. '16.0'`,
    ),
    plistProblem(`${field}.infoPlist`, target.infoPlist, '{ NSExtension: { ... } }'),
    plistProblem(
      `${field}.entitlements`,
      target.entitlements,
      "{ 'aps-environment': 'production' }",
    ),
    check(
      target.appGroups === undefined || typeof target.appGroups === 'boolean',
      `${field}.appGroups: true to share ios.appGroups with the app`,
    ),
    check(
      target.appGroups !== true || appGroups.length > 0,
      `${field}.appGroups: shares ios.appGroups, which nativue.config.ts doesn't set, e.g. ios: { appGroups: ['group.com.company.myapp'] }`,
    ),
    check(
      target.buildSettings === undefined || isStringRecord(target.buildSettings),
      `${field}.buildSettings: e.g. { SWIFT_VERSION: '6.0' }`,
    ),
  ]
}

/** Throws with every problem of the extension targets the plugins and native/extensions add. */
/** appGroups: the app's ios.appGroups, which targets with appGroups: true share. */
export function validateExtensionTargets(targets, { appDirectory, appGroups = [] }) {
  const names = targets.map((target) => target?.name)
  // macOS doesn't tell Extensions/Widget from Extensions/widget.
  const folderNames = names.map((name) => String(name).toLowerCase())
  const problems = targets.flatMap((target, index) => {
    const name = names[index]
    const field = `ios target ${typeof name === 'string' ? name : index}`

    if (!isObject(target)) return [`${field}: e.g. { name: 'NotificationService', ... }`]

    return [
      check(
        EXTENSION_NAME.test(name ?? '') &&
          !['app', 'nativueplugins'].includes(folderNames[index]) &&
          folderNames.indexOf(folderNames[index]) === index,
        `${field}.name: letters, digits and underscores, other than App, NativuePlugins and the other targets' (whatever their case)`,
      ),
      ...extensionTargetProblems(target, field, { appDirectory, appGroups }),
    ]
  })
  const found = problems.filter(Boolean)

  if (found.length === 0) return

  throw new Error(
    `The app's extension targets have invalid fields:\n${found.map((problem) => `  ${problem}`).join('\n')}`,
  )
}

/** A resource with its defaults: where it lands on each platform, or false for none. */
function resourceWithDefaults(resource) {
  const fileName = basename(String(resource.source))
  const android = resource.android !== false && {
    type: resource.font ? 'font' : 'raw',
    ...resource.android,
  }
  const defaultAndroidName =
    android.type === 'assets' ? fileName : basename(fileName, extname(fileName))

  return {
    source: resource.source,
    font: resource.font === true,
    ios: resource.ios !== false && { destination: fileName, ...resource.ios },
    android: android && { ...android, name: android.name ?? defaultAndroidName },
  }
}

/** The plugins' resources, then the app's: a later one at the same place replaces an earlier one. */
export function appResources(config, plugins = []) {
  return [...plugins.flatMap((plugin) => plugin.resources ?? []), ...(config.resources ?? [])].map(
    resourceWithDefaults,
  )
}

/** The fonts' file names, once: a later resource at the same place replaces an earlier one. */
export function iosFonts(resources) {
  const byDestination = new Map(
    resources.filter(({ ios }) => ios).map((resource) => [resource.ios.destination, resource]),
  )

  return [...byDestination.values()].filter(({ font }) => font).map(({ ios }) => ios.destination)
}

/** Where a resource lands in android/app/src/main. */
export function resourceFile({ source, android }) {
  return android.type === 'assets'
    ? `assets/${android.name}`
    : `res/${android.type}/${android.name}${extname(source)}`
}

function resourceProblems(resource, field, appDirectory) {
  if (!isObject(resource) || typeof resource.source !== 'string') {
    return [`${field}: e.g. { source: './assets/chime.wav' }`]
  }

  const { source, ios, android } = resourceWithDefaults(resource)
  const fullPath = resolve(appDirectory, source)

  return [
    check(
      existsSync(fullPath) && statSync(fullPath).isFile(),
      `${field}.source: ${source} isn't a file`,
    ),
    check(
      !ios || /^(?!\.\.?$)[^/\\]+$/.test(ios.destination),
      `${field}.ios.destination: a file name, e.g. 'chime.wav'`,
    ),
    check(
      !android || ANDROID_RESOURCE_TYPES.includes(android.type),
      `${field}.android.type: one of ${ANDROID_RESOURCE_TYPES.join(', ')}`,
    ),
    check(
      !android ||
        (android.type === 'assets'
          ? android.name.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
          : isAndroidResourceName(android.name)),
      `${field}.android.name: lowercase letters, digits and underscores, not a Java keyword, e.g. '${basename(
        source,
        extname(source),
      )
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')}'`,
    ),
  ]
}

/** The app's resources and each plugin's, named after where they come from. */
function allResourceProblems(config, plugins, appDirectory) {
  const sources = [
    ...plugins.map((plugin) => [`${plugin.name}'s resources`, plugin.resources]),
    ['resources', config.resources],
  ]

  return sources.flatMap(([field, resources]) => {
    if (resources === undefined) return []
    if (!Array.isArray(resources))
      return [`${field}: a list, e.g. [{ source: './assets/chime.wav' }]`]

    return resources.flatMap((resource, index) =>
      resourceProblems(resource, `${field}[${index}]`, appDirectory),
    )
  })
}

function generatedProjectProblems(config, appDirectory, plugins) {
  const { splash, buildNumber } = config
  const ios = config.ios ?? {}
  const android = config.android ?? {}

  return [
    check(
      typeof config.name === 'string' && config.name.trim() !== '',
      "name: the app's name, e.g. name: 'My App'",
    ),
    schemeProblems(config.scheme),
    check(
      config.version === undefined || VERSION.test(config.version),
      "version: three numbers, e.g. version: '1.2.0'",
    ),
    check(
      buildNumber === undefined ||
        (Number.isInteger(buildNumber) && buildNumber > 0 && buildNumber <= MAXIMUM_BUILD_NUMBER),
      `buildNumber: a whole number from 1 to ${MAXIMUM_BUILD_NUMBER}, raised for every release`,
    ),
    imageProblem('icon', config.icon, appDirectory, ICON_SIZE, { opaque: true }),
    imageProblem('splash.image', splash?.image, appDirectory, SPLASH_IMAGE_SIZE),
    imageProblem('splash.darkImage', splash?.darkImage, appDirectory, SPLASH_IMAGE_SIZE),
    colorProblem('splash.backgroundColor', splash?.backgroundColor),
    colorProblem('splash.darkBackgroundColor', splash?.darkBackgroundColor),
    check(
      splash?.darkImage === undefined || splash.image !== undefined,
      'splash.darkImage: needs splash.image, shown in light mode',
    ),
    check(
      IOS_BUNDLE_IDENTIFIER.test(ios.bundleIdentifier ?? ''),
      "ios.bundleIdentifier: e.g. ios: { bundleIdentifier: 'com.company.myapp' }",
    ),
    check(
      ios.appleTeamId === undefined || APPLE_TEAM_ID.test(ios.appleTeamId),
      'ios.appleTeamId: the 10 characters of your team id, from Signing & Capabilities in Xcode',
    ),
    plistProblem('ios.infoPlist', ios.infoPlist, "{ NSCameraUsageDescription: 'Scans receipts' }"),
    plistProblem('ios.entitlements', ios.entitlements, "{ 'aps-environment': 'development' }"),
    check(
      ios.appGroups === undefined ||
        (Array.isArray(ios.appGroups) && ios.appGroups.every((group) => APP_GROUP.test(group))),
      "ios.appGroups: e.g. ['group.com.company.myapp']",
    ),
    check(
      ANDROID_PACKAGE.test(android.package ?? ''),
      "android.package: e.g. android: { package: 'com.company.myapp' }, without hyphens",
    ),
    check(
      android.permissions === undefined ||
        (Array.isArray(android.permissions) &&
          android.permissions.every((permission) => ANDROID_PERMISSION.test(permission))),
      "android.permissions: full names, e.g. ['android.permission.CAMERA']",
    ),
    check(
      android.blockedPermissions === undefined ||
        (Array.isArray(android.blockedPermissions) &&
          android.blockedPermissions.every((permission) => ANDROID_PERMISSION.test(permission))),
      "android.blockedPermissions: full names, e.g. ['android.permission.READ_MEDIA_IMAGES']",
    ),
    check(
      android.adaptiveIcon === undefined || android.adaptiveIcon.foregroundImage !== undefined,
      "android.adaptiveIcon.foregroundImage: the icon's square PNG, e.g. './assets/adaptive-icon.png'",
    ),
    imageProblem(
      'android.adaptiveIcon.foregroundImage',
      android.adaptiveIcon?.foregroundImage,
      appDirectory,
    ),
    colorProblem('android.adaptiveIcon.backgroundColor', android.adaptiveIcon?.backgroundColor),
    ...signingProblems(android.signing, appDirectory),
    ...gradleProblems(android.gradle),
    ...allResourceProblems(config, plugins, appDirectory),
  ]
}

function manualProjectProblems(config) {
  return GENERATED_PROJECT_FIELDS.filter((field) => field in config).map(
    (field) =>
      `${field}: nativue uses it only to generate ios/ and android/, which prebuild: false keeps by hand. Set it in those folders instead`,
  )
}

/** Throws with every problem of the config at once, before anything is generated. */
export function validateConfig(config, appDirectory, plugins = []) {
  const problems = (
    config.prebuild === false
      ? manualProjectProblems(config)
      : generatedProjectProblems(config, appDirectory, plugins)
  ).filter(Boolean)

  if (problems.length === 0) return

  throw new Error(
    `nativue.config.ts has invalid fields:\n${problems.map((problem) => `  ${problem}`).join('\n')}`,
  )
}

/** The config with its defaults, as the project generators read it. */
export function appConfig(config) {
  const splash = config.splash ?? {}
  const splashBackgroundColor = splash.backgroundColor ?? DEFAULTS.splashBackgroundColor

  return {
    ...config,
    schemes: [config.scheme].flat(),
    version: config.version ?? DEFAULTS.version,
    buildNumber: config.buildNumber ?? DEFAULTS.buildNumber,
    splash: {
      image: splash.image,
      darkImage: splash.darkImage ?? splash.image,
      backgroundColor: splashBackgroundColor,
      // The template's dark logo is made for Ink: keep it unless the app has its own logo.
      darkBackgroundColor:
        splash.darkBackgroundColor ??
        (splash.image ? splashBackgroundColor : DEFAULTS.darkSplashBackgroundColor),
    },
    iconBackgroundColor:
      config.android.adaptiveIcon?.backgroundColor ?? DEFAULTS.iconBackgroundColor,
  }
}
