// nativue.config.ts as prebuild reads it: every problem at once, then the config with its defaults.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

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

function generatedProjectProblems(config, appDirectory) {
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
  ]
}

function manualProjectProblems(config) {
  return GENERATED_PROJECT_FIELDS.filter((field) => field in config).map(
    (field) =>
      `${field}: nativue uses it only to generate ios/ and android/, which prebuild: false keeps by hand. Set it in those folders instead`,
  )
}

/** Throws with every problem of the config at once, before anything is generated. */
export function validateConfig(config, appDirectory) {
  const problems = (
    config.prebuild === false
      ? manualProjectProblems(config)
      : generatedProjectProblems(config, appDirectory)
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
