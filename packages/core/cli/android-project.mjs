// The Android project files prebuild builds from the config, instead of copying them from the
// template: the app's manifest, Gradle files and strings, its resources, and the icon and splash
// images. A null file removes the template's.
import { readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { toPosixPath } from './link.mjs'
import { appResources, emptyGradle, gradleProblems, resourceFile } from './app-config.mjs'
import { applyMods } from './plugins.mjs'
import { androidString, xml } from './serialize.mjs'

// Changes the activity handles itself, so they don't recreate it and restart JS.
const CONFIG_CHANGES = [
  'orientation',
  'screenSize',
  'smallestScreenSize',
  'screenLayout',
  'keyboard',
  'keyboardHidden',
  'uiMode',
  'fontScale',
  'locale',
  'layoutDirection',
]
const ANDROID_PLUGIN_VERSION = '9.5.1'
const ANDROID_NAMESPACE = 'http://schemas.android.com/apk/res/android'
const TOOLS_NAMESPACE = 'http://schemas.android.com/tools'
// The splash icon without a background is 288dp; the logo, 120dp as on iOS, is inset in it. A
// fraction, since Android scales the icon to its own size.
const SPLASH_LOGO_INSET = `${(((288 - 120) / 2 / 288) * 100).toFixed(2)}%`

/** Inside a Kotlin "string": no escapes or $templates. */
function kotlinString(text) {
  return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('$', '\\$')}"`
}

function element(tag, attributes = {}, children = []) {
  return { tag, attributes, children }
}

function intentFilter(action, categories, children = []) {
  return element('intent-filter', {}, [
    element('action', { 'android:name': action }),
    ...categories.map((category) => element('category', { 'android:name': category })),
    ...children,
  ])
}

/** The base manifest, every element a plugin's manifest mod may change. */
export function nativueManifest(app) {
  const mainActivity = element(
    'activity',
    {
      'android:name': '.MainActivity',
      'android:configChanges': CONFIG_CHANGES.join('|'),
      'android:exported': 'true',
      'android:launchMode': 'singleTask',
      'android:windowSoftInputMode': 'adjustResize',
    },
    [
      intentFilter('android.intent.action.MAIN', ['android.intent.category.LAUNCHER']),
      intentFilter(
        'android.intent.action.VIEW',
        ['android.intent.category.DEFAULT', 'android.intent.category.BROWSABLE'],
        app.schemes.map((scheme) => element('data', { 'android:scheme': scheme })),
      ),
    ],
  )
  const application = element(
    'application',
    {
      'android:icon': '@mipmap/ic_launcher',
      'android:label': '@string/app_name',
      'android:theme': '@style/AppTheme',
    },
    [mainActivity],
  )

  return element(
    'manifest',
    { 'xmlns:android': ANDROID_NAMESPACE, 'xmlns:tools': TOOLS_NAMESPACE },
    [application],
  )
}

function isPermission(child, names) {
  return child.tag === 'uses-permission' && names.includes(child.attributes['android:name'])
}

/**
 * nativue's manifest, then the plugins' mods, then the app's permissions. A blocked permission is
 * removed here and, with tools:node="remove", from the packages' manifests Gradle merges in.
 */
function manifest(app, plugins, context) {
  const document = applyMods(plugins, 'android', 'manifest', nativueManifest(app), context)
  const blocked = app.android.blockedPermissions ?? []
  const requested = (app.android.permissions ?? []).filter((name) => !blocked.includes(name))
  const permissions = [
    ...requested.map((name) => element('uses-permission', { 'android:name': name })),
    ...blocked.map((name) =>
      element('uses-permission', { 'android:name': name, 'tools:node': 'remove' }),
    ),
  ]

  return {
    ...document,
    children: [
      ...permissions,
      // The app's entry replaces a plugin's of the same name, whatever attributes it had.
      ...document.children.filter((child) => !isPermission(child, [...requested, ...blocked])),
    ],
  }
}

/** The plugins' strings, then the app's name. */
function strings(app, plugins, context) {
  const values = { ...applyMods(plugins, 'android', 'strings', {}, context), app_name: app.name }

  return element(
    'resources',
    {},
    Object.entries(values).map(([name, text]) => ({
      tag: 'string',
      attributes: { name },
      text: androidString(String(text)),
    })),
  )
}

/** Release signing from a keystore outside android/, its passwords never written to a file. */
function signingGradle(signing, appDirectory) {
  if (!signing) return { top: '', android: '' }

  const storeFile = toPosixPath(
    relative(join(appDirectory, 'android', 'app'), resolve(appDirectory, signing.storeFile)),
  )
  const secrets = [signing.storePasswordEnv, signing.keyPasswordEnv]

  return {
    top: `
// Release signing's passwords: a Gradle property (~/.gradle/gradle.properties, which Android Studio
// reads too) or an environment variable (CI). Debug builds don't need them.
fun secret(name: String): String? =
    providers.gradleProperty(name).orElse(providers.environmentVariable(name)).orNull

val missingSigningSecrets = listOf(${secrets.map((name) => `"${name}"`).join(', ')}).filter { secret(it) == null }

// Stops before building, with the names; any other release build fails at signing.
if (missingSigningSecrets.isNotEmpty() && gradle.startParameter.taskNames.any { it.contains("Release") }) {
    throw GradleException(
        ${kotlinString(`A release build is signed with ${signing.storeFile}, and needs `)} +
            missingSigningSecrets.joinToString() +
            ": set them as environment variables, or in ~/.gradle/gradle.properties.",
    )
}
`,
    android: `
    signingConfigs {
        create("release") {
            storeFile = file(${kotlinString(storeFile)})
            storePassword = secret("${signing.storePasswordEnv}")
            keyAlias = ${kotlinString(signing.keyAlias)}
            keyPassword = secret("${signing.keyPasswordEnv}")
        }
    }

    buildTypes {
        getByName("release") {
            signingConfig = signingConfigs.getByName("release")
        }
    }
`,
  }
}

function unique(values) {
  return [...new Set(values)]
}

/** The plugins' gradle mods, then the app's android.gradle: its values win, lists are joined. */
function gradleModel(app, plugins, context) {
  const fromPlugins = applyMods(plugins, 'android', 'gradle', emptyGradle(), context)
  const problems = gradleProblems(fromPlugins, "the plugins' gradle mods' result").filter(Boolean)

  if (problems.length > 0) throw new Error(problems.join('\n'))

  const ownGradle = app.android.gradle ?? {}
  const own = Object.fromEntries(
    Object.entries(emptyGradle()).map(([key, empty]) => [key, ownGradle[key] ?? empty]),
  )
  const gradlePlugins = [...fromPlugins.plugins, ...own.plugins]

  return {
    plugins: [...new Map(gradlePlugins.map((plugin) => [plugin.id, plugin])).values()],
    dependencies: unique([...fromPlugins.dependencies, ...own.dependencies]),
    manifestPlaceholders: { ...fromPlugins.manifestPlaceholders, ...own.manifestPlaceholders },
    repositories: unique([...fromPlugins.repositories, ...own.repositories]),
    properties: { ...fromPlugins.properties, ...own.properties },
  }
}

function lines(values, indent) {
  return values.map((value) => `${indent}${value}\n`).join('')
}

function appGradle(app, appDirectory, gradle) {
  const signing = signingGradle(app.android.signing, appDirectory)
  const pluginIds = gradle.plugins.map(({ id }) => `id(${kotlinString(id)})`)
  const placeholders = Object.entries(gradle.manifestPlaceholders).map(
    ([key, value]) => `manifestPlaceholders[${kotlinString(key)}] = ${kotlinString(value)}`,
  )
  const dependencies = gradle.dependencies.map(
    (dependency) => `implementation(${kotlinString(dependency)})`,
  )

  return `plugins {
    id("com.android.application")
${lines(pluginIds, '    ')}}
${signing.top}
android {
    namespace = "${app.android.package}"
    compileSdk = 37

    defaultConfig {
        applicationId = "${app.android.package}"
        minSdk = 24
        targetSdk = 36
        versionCode = ${app.buildNumber}
        versionName = "${app.version}"
${lines(placeholders, '        ')}    }
${signing.android}
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(project(":nativue"))
${lines(dependencies, '    ')}}
`
}

/** The root build file: the version of every Gradle plugin the app applies. */
function rootGradle(gradle) {
  const versioned = gradle.plugins
    .filter(({ version }) => version)
    .map(
      ({ id, version }) => `id(${kotlinString(id)}) version ${kotlinString(version)} apply false`,
    )

  return `plugins {
    id("com.android.application") version "${ANDROID_PLUGIN_VERSION}" apply false
    id("com.android.library") version "${ANDROID_PLUGIN_VERSION}" apply false
${lines(versioned, '    ')}}
`
}

function settingsGradle(gradle, corePath) {
  const repositories = lines(
    gradle.repositories.map((url) => `maven(${kotlinString(url)})`),
    '        ',
  )

  return `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
${repositories}    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
${repositories}    }
}

rootProject.name = "App"
include(":app")
include(":nativue")
project(":nativue").projectDir = file("${corePath}/android")
// The Android side of the app's packages (see the file)
apply(from = "${corePath}/android/nativue.settings.gradle.kts")
`
}

function gradleProperties(gradle) {
  const properties = Object.entries(gradle.properties).map(([key, value]) => `${key}=${value}`)

  return `org.gradle.jvmargs=-Xmx4g -Dfile.encoding=UTF-8\n${lines(properties, '')}`
}

/** res/<type>/<name>.<extension>, or assets/<name>. */
function resourceFiles(resources, readAppFile) {
  return Object.fromEntries(
    resources
      .filter((resource) => resource.android)
      .map((resource) => [
        `app/src/main/${resourceFile(resource)}`,
        { content: readAppFile(resource.source) },
      ]),
  )
}

/** The template's logo, or the app's centered at 120dp in the splash icon. */
function splashFiles(splash, readAppFile) {
  if (!splash.image) return {}

  const icon = element('inset', {
    'xmlns:android': ANDROID_NAMESPACE,
    'android:drawable': '@drawable/splash_image',
    'android:inset': SPLASH_LOGO_INSET,
  })

  return {
    'app/src/main/res/drawable-xxxhdpi/splash_logo.png': null,
    'app/src/main/res/drawable-night-xxxhdpi/splash_logo.png': null,
    'app/src/main/res/drawable/splash_logo.xml': xml(icon),
    // 360px at 3x is the logo's 120dp.
    'app/src/main/res/drawable-xxhdpi/splash_image.png': { content: readAppFile(splash.image) },
    'app/src/main/res/drawable-night-xxhdpi/splash_image.png': {
      content: readAppFile(splash.darkImage),
    },
  }
}

/** The legacy icon, and the adaptive one Android 8+ shows; without it, the legacy icon everywhere. */
function iconFiles(app, readAppFile) {
  const adaptiveIcon = app.android.adaptiveIcon
  const legacy = app.icon
    ? { 'app/src/main/res/mipmap-xxxhdpi/ic_launcher.png': { content: readAppFile(app.icon) } }
    : {}

  if (adaptiveIcon) {
    // No <monochrome>: Android 13's themed icon would tint the whole colored foreground.
    const icon = element('adaptive-icon', { 'xmlns:android': ANDROID_NAMESPACE }, [
      element('background', { 'android:drawable': '@color/ic_launcher_background' }),
      element('foreground', { 'android:drawable': '@mipmap/ic_launcher_foreground' }),
    ])

    return {
      ...legacy,
      'app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml': xml(icon),
      'app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png': {
        content: readAppFile(adaptiveIcon.foregroundImage),
      },
    }
  }

  if (!app.icon) return {}

  return {
    ...legacy,
    'app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml': null,
    'app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png': null,
  }
}

/** Paths relative to android/. */
export function androidProjectFiles(app, { appDirectory, corePath, plugins = [] }) {
  const readAppFile = (path) => readFileSync(resolve(appDirectory, path))
  const context = { config: app, projectRoot: appDirectory }
  const gradle = gradleModel(app, plugins, context)

  return {
    'build.gradle.kts': rootGradle(gradle),
    'settings.gradle.kts': settingsGradle(gradle, corePath),
    'gradle.properties': gradleProperties(gradle),
    'app/build.gradle.kts': appGradle(app, appDirectory, gradle),
    'app/src/main/AndroidManifest.xml': xml(manifest(app, plugins, context)),
    'app/src/main/res/values/strings.xml': xml(strings(app, plugins, context)),
    ...iconFiles(app, readAppFile),
    ...splashFiles(app.splash, readAppFile),
    ...resourceFiles(appResources(app, plugins), readAppFile),
  }
}
