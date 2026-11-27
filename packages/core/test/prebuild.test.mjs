// nativue prebuild on a throwaway app: the generated files against snapshots (UPDATE_SNAPSHOTS=1
// rewrites them), idempotency, and every way a hand edit stops it.
import assert from 'node:assert'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolvePlugins } from '../cli/plugins.mjs'
import { linkNativePackages, prebuild } from '../cli/prebuild.mjs'

const CORE_DIRECTORY = fileURLToPath(new URL('..', import.meta.url))
const SNAPSHOTS_DIRECTORY = fileURLToPath(new URL('snapshots', import.meta.url))
const SNAPSHOTS = {
  'project.pbxproj': 'ios/App.xcodeproj/project.pbxproj',
  'Info.plist': 'ios/Info.plist',
  'AndroidManifest.xml': 'android/app/src/main/AndroidManifest.xml',
  'strings.xml': 'android/app/src/main/res/values/strings.xml',
  'build.gradle.kts': 'android/app/build.gradle.kts',
  'settings.gradle.kts': 'android/settings.gradle.kts',
  'App.entitlements': 'ios/App.entitlements',
  'LaunchBackground.json': 'ios/App/Assets.xcassets/LaunchBackground.colorset/Contents.json',
  'styles.xml': 'android/app/src/main/res/values/styles.xml',
  'root.build.gradle.kts': 'android/build.gradle.kts',
  'gradle.properties': 'android/gradle.properties',
}
const CONFIG = {
  name: "Tom's App",
  scheme: ['tomsapp', 'toms'],
  version: '1.2.0',
  buildNumber: 12,
  splash: { backgroundColor: '#F1F5F9', darkBackgroundColor: '#0B1220' },
  ios: {
    bundleIdentifier: 'com.example.tomsapp',
    appleTeamId: 'ABCDE12345',
    infoPlist: { NSCameraUsageDescription: 'Scans receipts' },
    entitlements: { 'aps-environment': 'development' },
  },
  android: {
    package: 'com.example.tomsapp',
    permissions: ['android.permission.CAMERA'],
    signing: {
      storeFile: './credentials/upload.keystore',
      keyAlias: 'upload',
      storePasswordEnv: 'ANDROID_STORE_PASSWORD',
      keyPasswordEnv: 'ANDROID_KEY_PASSWORD',
    },
    gradle: {
      dependencies: ['com.squareup.okhttp3:okhttp:4.12.0'],
      manifestPlaceholders: { appAuthRedirectScheme: 'tomsapp' },
      properties: { 'android.enableJetifier': 'true' },
    },
  },
  resources: [{ source: './assets/Inter-Bold.ttf', font: true, android: { name: 'inter_bold' } }],
}
const MANUAL_CONFIG = { prebuild: false }
// Every mod, as a package's plugin would use them.
const PUSH_PLUGIN = {
  name: 'push',
  resources: [{ source: './sounds/chime.wav' }],
  ios: {
    infoPlist(infoPlist) {
      infoPlist.UIBackgroundModes = ['remote-notification']
      infoPlist.NSCameraUsageDescription = 'From the plugin'
    },
    entitlements(entitlements) {
      entitlements['aps-environment'] = 'production'
    },
  },
  android: {
    manifest(manifest, { config }) {
      manifest.children.unshift({
        tag: 'uses-permission',
        attributes: { 'android:name': 'android.permission.POST_NOTIFICATIONS' },
        children: [],
      })
      manifest.children
        .find((child) => child.tag === 'application')
        .children.push({
          tag: 'meta-data',
          attributes: {
            'android:name': 'push.channel',
            // With prebuild: false, the config has no android.
            'android:value': `${config.android?.package}.default`,
            'tools:replace': 'android:value',
          },
          children: [],
        })
    },
    strings(strings) {
      strings.push_channel_name = "Tom's updates"
    },
    gradle(gradle) {
      gradle.plugins.push({ id: 'com.google.gms.google-services', version: '4.4.2' })
      gradle.dependencies.push('com.google.firebase:firebase-messaging:24.1.0')
      gradle.repositories.push('https://jitpack.io')
    },
  },
}

/** Only a PNG's header: what prebuild reads of it, besides copying it. */
function png(width, height, colorType = 2) {
  const header = Buffer.alloc(26)

  Buffer.from('89504e470d0a1a0a', 'hex').copy(header)
  header.writeUInt32BE(width, 16)
  header.writeUInt32BE(height, 20)
  header[25] = colorType

  return header
}

function createApp() {
  const appDirectory = mkdtempSync(join(tmpdir(), 'nativue-prebuild-test-'))
  writeFileSync(join(appDirectory, 'package.json'), '{ "dependencies": {} }')
  mkdirSync(join(appDirectory, 'assets'))
  mkdirSync(join(appDirectory, 'sounds'))
  writeFileSync(join(appDirectory, 'assets/Inter-Bold.ttf'), 'font')
  writeFileSync(join(appDirectory, 'sounds/chime.wav'), 'sound')

  return appDirectory
}

function run(appDirectory, options = {}) {
  return prebuild({
    config: CONFIG,
    plugins: [PUSH_PLUGIN],
    appDirectory,
    coreDirectory: CORE_DIRECTORY,
    ...options,
  })
}

const read = (appDirectory, path) => readFileSync(join(appDirectory, path), 'utf8')
const isPresent = (appDirectory, path) =>
  lstatSync(join(appDirectory, path), { throwIfNoEntry: false }) !== undefined

/** The core's path, relative to the temporary app, differs between machines. */
function withoutCorePath(text) {
  return text.replaceAll(/(\.\.\/)+[^"]*?packages\/core/g, '__CORE_PATH__')
}

function checkSnapshots(appDirectory, snapshots = SNAPSHOTS) {
  for (const [snapshot, path] of Object.entries(snapshots)) {
    const snapshotPath = join(SNAPSHOTS_DIRECTORY, snapshot)
    const generated = withoutCorePath(read(appDirectory, path))

    if (process.env.UPDATE_SNAPSHOTS) writeFileSync(snapshotPath, generated)
    else assert.strictEqual(generated, readFileSync(snapshotPath, 'utf8'), `${path} vs ${snapshot}`)
  }
}

const appDirectories = []
function test(name, body) {
  const appDirectory = createApp()
  appDirectories.push(appDirectory)
  body(appDirectory)
  console.log(`ok - ${name}`)
}

async function asyncTest(name, body) {
  const appDirectory = createApp()
  appDirectories.push(appDirectory)
  await body(appDirectory)
  console.log(`ok - ${name}`)
}

try {
  test('generates both projects, as in the snapshots', (appDirectory) => {
    const written = run(appDirectory)

    assert.ok(written.includes('ios/App.xcodeproj/project.pbxproj'))
    assert.ok(written.includes('android/gradlew'))
    assert.ok(existsSync(join(appDirectory, 'ios/.nativue/generated.json')))
    assert.ok(
      existsSync(
        join(
          appDirectory,
          'ios/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved',
        ),
      ),
    )
    checkSnapshots(appDirectory)
  })

  test('writes nothing the second time', (appDirectory) => {
    run(appDirectory)

    assert.deepStrictEqual(run(appDirectory), [])
  })

  test('leaves build folders alone, and counts a folder holding only them as empty', (appDirectory) => {
    mkdirSync(join(appDirectory, 'ios/build/Build'), { recursive: true })
    writeFileSync(join(appDirectory, 'ios/build/Build/cache'), 'x')
    mkdirSync(join(appDirectory, 'android/.gradle'), { recursive: true })
    writeFileSync(join(appDirectory, 'android/local.properties'), 'sdk.dir=/sdk')

    run(appDirectory)
    run(appDirectory)

    assert.strictEqual(read(appDirectory, 'ios/build/Build/cache'), 'x')
    assert.strictEqual(read(appDirectory, 'android/local.properties'), 'sdk.dir=/sdk')
  })

  test('stops, without writing, on a file edited by hand', (appDirectory) => {
    run(appDirectory)
    writeFileSync(join(appDirectory, 'ios/Info.plist'), 'edited')
    const record = read(appDirectory, 'android/.nativue/generated.json')

    assert.throws(() => run(appDirectory), /changed: ios\/Info\.plist/)
    assert.strictEqual(read(appDirectory, 'ios/Info.plist'), 'edited')
    assert.strictEqual(read(appDirectory, 'android/.nativue/generated.json'), record)
  })

  test('stops on a file added by hand', (appDirectory) => {
    run(appDirectory)
    writeFileSync(join(appDirectory, 'android/app/src/main/java/Extra.kt'), 'class Extra')

    assert.throws(() => run(appDirectory), /added: {3}android\/app\/src\/main\/java\/Extra\.kt/)
  })

  test("stops on a folder nativue didn't generate, and leaves it alone", (appDirectory) => {
    mkdirSync(join(appDirectory, 'ios'))
    writeFileSync(join(appDirectory, 'ios/Info.plist'), 'hand-made')

    assert.throws(() => run(appDirectory), /ios\/ wasn't generated by nativue/)
    assert.strictEqual(read(appDirectory, 'ios/Info.plist'), 'hand-made')
    assert.ok(!existsSync(join(appDirectory, 'android')))
  })

  test('--force overwrites edited files and deletes added ones', (appDirectory) => {
    run(appDirectory)
    const original = read(appDirectory, 'ios/Info.plist')
    writeFileSync(join(appDirectory, 'ios/Info.plist'), 'edited')
    writeFileSync(join(appDirectory, 'ios/App/Extra.swift'), '')

    run(appDirectory, { force: true })

    assert.strictEqual(read(appDirectory, 'ios/Info.plist'), original)
    assert.ok(!existsSync(join(appDirectory, 'ios/App/Extra.swift')))
    assert.deepStrictEqual(run(appDirectory), [])
  })

  test("a prebuild that stopped halfway isn't taken for hand edits", (appDirectory) => {
    run(appDirectory)
    const recordPath = join(appDirectory, 'ios/.nativue/generated.json')
    const finished = JSON.parse(readFileSync(recordPath, 'utf8'))
    const renamed = { ...CONFIG, name: 'Renamed' }
    const renamedApp = createApp()
    appDirectories.push(renamedApp)
    run(renamedApp, { config: renamed })
    const pending = JSON.parse(
      readFileSync(join(renamedApp, 'ios/.nativue/generated.json'), 'utf8'),
    )

    // As if it stopped after the pending record and one of the new files.
    writeFileSync(recordPath, JSON.stringify({ ...finished, pending: pending.files }))
    writeFileSync(join(appDirectory, 'ios/Info.plist'), read(renamedApp, 'ios/Info.plist'))

    const written = run(appDirectory, { config: renamed })

    assert.ok(written.includes('ios/App.xcodeproj/project.pbxproj'))
    assert.strictEqual(
      read(appDirectory, 'ios/App.xcodeproj/project.pbxproj'),
      read(renamedApp, 'ios/App.xcodeproj/project.pbxproj'),
    )
  })

  test('removes files it no longer generates', (appDirectory) => {
    mkdirSync(join(appDirectory, 'native/battery/ios'), { recursive: true })
    writeFileSync(join(appDirectory, 'native/battery/ios/BatteryPlugin.swift'), '')
    run(appDirectory)
    assert.ok(isPresent(appDirectory, 'ios/NativuePlugins/Sources/AppBattery'))

    rmSync(join(appDirectory, 'native'), { recursive: true })
    run(appDirectory)

    assert.ok(!isPresent(appDirectory, 'ios/NativuePlugins/Sources/AppBattery'))
  })

  test('points a team picked in Xcode to ios.appleTeamId', (appDirectory) => {
    run(appDirectory)
    const projectPath = join(appDirectory, 'ios/App.xcodeproj/project.pbxproj')
    writeFileSync(
      projectPath,
      readFileSync(projectPath, 'utf8').replaceAll('ABCDE12345', 'ZYXWV98765'),
    )

    assert.throws(() => run(appDirectory), /appleTeamId: 'ZYXWV98765'/)
  })

  test('--force replaces a folder where a generated file belongs', (appDirectory) => {
    run(appDirectory)
    rmSync(join(appDirectory, 'ios/Info.plist'))
    mkdirSync(join(appDirectory, 'ios/Info.plist/inside'), { recursive: true })
    writeFileSync(join(appDirectory, 'ios/Info.plist/inside/file'), '')

    run(appDirectory, { force: true })

    assert.match(read(appDirectory, 'ios/Info.plist'), /<plist/)
  })

  test("with prebuild: false, only links the packages into the app's own ios/", (appDirectory) => {
    mkdirSync(join(appDirectory, 'ios'))
    writeFileSync(join(appDirectory, 'ios/Info.plist'), 'hand-made')
    mkdirSync(join(appDirectory, 'native/battery/ios'), { recursive: true })

    linkNativePackages({ config: MANUAL_CONFIG, appDirectory, coreDirectory: CORE_DIRECTORY })
    assert.ok(isPresent(appDirectory, 'ios/NativuePlugins/Sources/AppBattery'))
    assert.strictEqual(read(appDirectory, 'ios/Info.plist'), 'hand-made')
    assert.ok(!existsSync(join(appDirectory, 'ios/.nativue')))

    rmSync(join(appDirectory, 'native'), { recursive: true })
    linkNativePackages({ config: MANUAL_CONFIG, appDirectory, coreDirectory: CORE_DIRECTORY })
    assert.ok(!isPresent(appDirectory, 'ios/NativuePlugins/Sources/AppBattery'))
    assert.deepStrictEqual(
      linkNativePackages({ config: MANUAL_CONFIG, appDirectory, coreDirectory: CORE_DIRECTORY }),
      [],
    )
  })

  test('with prebuild: false, refuses the fields only generated projects use', (appDirectory) => {
    assert.throws(
      () =>
        linkNativePackages({
          config: { prebuild: false, name: 'App', ios: {} },
          appDirectory,
          coreDirectory: CORE_DIRECTORY,
        }),
      (error) => error.message.includes('  name:') && error.message.includes('  ios:'),
    )
  })

  test("uses the app's icon and splash images", (appDirectory) => {
    mkdirSync(join(appDirectory, 'assets'), { recursive: true })
    writeFileSync(join(appDirectory, 'assets/icon.png'), png(1024, 1024))
    writeFileSync(join(appDirectory, 'assets/splash.png'), png(360, 360))
    const config = {
      ...CONFIG,
      icon: './assets/icon.png',
      splash: { image: './assets/splash.png' },
    }

    run(appDirectory, { config })

    const launchLogo = 'ios/App/Assets.xcassets/LaunchLogo.imageset'
    const resources = 'android/app/src/main/res'
    assert.deepStrictEqual(
      readFileSync(join(appDirectory, 'ios/App/Assets.xcassets/AppIcon.appiconset/icon.png')),
      png(1024, 1024),
    )
    assert.ok(isPresent(appDirectory, `${launchLogo}/logo-dark@3x.png`))
    assert.ok(!isPresent(appDirectory, `${launchLogo}/logo@1x.png`))
    assert.ok(isPresent(appDirectory, `${resources}/drawable-night-xxhdpi/splash_image.png`))
    assert.ok(!isPresent(appDirectory, `${resources}/drawable-xxxhdpi/splash_logo.png`))
    assert.match(
      read(appDirectory, `${resources}/drawable/splash_logo.xml`),
      /android:inset="29.17%"/,
    )
    // Without an adaptive icon, the legacy one is used on every version.
    assert.ok(!isPresent(appDirectory, `${resources}/mipmap-anydpi-v26/ic_launcher.xml`))
    assert.deepStrictEqual(run(appDirectory, { config }), [])
  })

  test('checks the size of every image', (appDirectory) => {
    writeFileSync(join(appDirectory, 'icon.png'), png(512, 512))
    writeFileSync(join(appDirectory, 'splash.jpg'), 'not a png')
    mkdirSync(join(appDirectory, 'assets'), { recursive: true })
    const config = {
      ...CONFIG,
      icon: './icon.png',
      splash: { image: './splash.jpg', darkImage: './assets' },
      android: { ...CONFIG.android, adaptiveIcon: { backgroundColor: '#FFFFFF' } },
    }
    const problems = [
      "icon: ./icon.png must be a 1024×1024 PNG, it's 512×512",
      "splash.image: ./splash.jpg must be a 360×360 PNG, it's not a PNG",
      "splash.darkImage: ./assets isn't a file",
      'android.adaptiveIcon.foregroundImage:',
    ]

    assert.throws(
      () => prebuild({ config, appDirectory, coreDirectory: CORE_DIRECTORY }),
      (error) => problems.every((problem) => error.message.includes(problem)),
    )
  })

  test('refuses a transparent icon, a keystore in android/ and a null platform', (appDirectory) => {
    writeFileSync(join(appDirectory, 'transparent.png'), png(1024, 1024, 6))
    const signing = { ...CONFIG.android.signing, storeFile: './Android/upload.keystore' }
    const config = {
      ...CONFIG,
      icon: './transparent.png',
      ios: null,
      android: { ...CONFIG.android, signing },
    }
    const problems = [
      'icon: ./transparent.png must have no transparency',
      'ios.bundleIdentifier:',
      'android.signing.storeFile:',
    ]

    assert.throws(
      () => prebuild({ config, appDirectory, coreDirectory: CORE_DIRECTORY }),
      (error) => problems.every((problem) => error.message.includes(problem)),
    )
  })

  test('merges Info.plist dictionaries, and escapes signing values in Gradle', (appDirectory) => {
    const config = {
      ...CONFIG,
      ios: {
        ...CONFIG.ios,
        infoPlist: {
          NSAppTransportSecurity: { NSExceptionDomains: { 'api.example.com': {} } },
          CFBundleURLTypes: [{ CFBundleURLSchemes: ['com.googleusercontent.apps.123'] }],
        },
      },
      android: { ...CONFIG.android, signing: { ...CONFIG.android.signing, keyAlias: 'my$"key' } },
    }

    run(appDirectory, { config })

    const infoPlist = read(appDirectory, 'ios/Info.plist')
    assert.match(infoPlist, /NSAllowsLocalNetworking/)
    assert.match(infoPlist, /api\.example\.com/)
    assert.match(infoPlist, /<string>tomsapp<\/string>/)
    assert.match(infoPlist, /com\.googleusercontent\.apps\.123/)
    assert.match(read(appDirectory, 'android/app/build.gradle.kts'), /keyAlias = "my\\\$\\"key"/)
  })

  test("applies the app's own fields after the plugins' mods", (appDirectory) => {
    const android = {
      ...CONFIG.android,
      blockedPermissions: ['android.permission.POST_NOTIFICATIONS'],
    }

    run(appDirectory, { config: { ...CONFIG, android } })

    const manifest = read(appDirectory, 'android/app/src/main/AndroidManifest.xml')

    assert.match(read(appDirectory, 'ios/Info.plist'), /<string>Scans receipts<\/string>/)
    assert.match(read(appDirectory, 'ios/App.entitlements'), /<string>development<\/string>/)
    assert.match(
      manifest,
      /android:name="android.permission.POST_NOTIFICATIONS"\n\s+tools:node="remove"/,
    )
    assert.strictEqual(manifest.match(/POST_NOTIFICATIONS/g).length, 1)

    const requested = { ...CONFIG.android, permissions: ['android.permission.POST_NOTIFICATIONS'] }
    run(appDirectory, { config: { ...CONFIG, android: requested } })

    assert.match(
      read(appDirectory, 'android/app/src/main/AndroidManifest.xml'),
      /<uses-permission android:name="android.permission.POST_NOTIFICATIONS" \/>/,
    )
  })

  test("with prebuild: false, asks for what the plugins' mods add", (appDirectory) => {
    mkdirSync(join(appDirectory, 'ios'))
    mkdirSync(join(appDirectory, 'android/app/src/main/res/values'), { recursive: true })
    const link = (options) =>
      linkNativePackages({
        config: MANUAL_CONFIG,
        plugins: [PUSH_PLUGIN],
        appDirectory,
        coreDirectory: CORE_DIRECTORY,
        ...options,
      })
    const missing = [
      'Info.plist: <key>UIBackgroundModes</key>',
      '.entitlements: <key>aps-environment</key>',
      'AndroidManifest.xml: <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
      'res/values strings: <string name="push_channel_name">',
    ]
    const failingPlugin = { name: 'failing', ios: { infoPlist: () => JSON.parse('') } }

    assert.throws(link, (error) => missing.every((entry) => error.message.includes(entry)))
    assert.throws(() => link({ plugins: [failingPlugin] }), /failing's ios\.infoPlist mod failed/)

    writeFileSync(
      join(appDirectory, 'android/app/src/main/AndroidManifest.xml'),
      '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
    )
    writeFileSync(
      join(appDirectory, 'android/app/src/main/res/values/strings.xml'),
      '<string name="push_channel_name">Updates</string>',
    )
    assert.throws(
      () => link({ platforms: ['android'] }),
      /build\.gradle\.kts: id\("com\.google\.gms\.google-services"\)/,
    )
    writeFileSync(
      join(appDirectory, 'android/app/build.gradle.kts'),
      // Groovy, another version: still there.
      "id 'com.google.gms.google-services'\nimplementation 'com.google.firebase:firebase-messaging:25.0.0'\nmaven { url 'https://jitpack.io' }",
    )
    mkdirSync(join(appDirectory, 'android/app/src/main/res/raw'))
    writeFileSync(join(appDirectory, 'android/app/src/main/res/raw/chime.wav'), 'sound')
    // The key without the plugin's value isn't enough.
    writeFileSync(
      join(appDirectory, 'ios/Info.plist'),
      '<key>UIBackgroundModes</key><array><string>audio</string></array>',
    )

    link({ platforms: ['android'] })
    assert.throws(link, /Info\.plist: <key>UIBackgroundModes<\/key>/)

    writeFileSync(
      join(appDirectory, 'ios/Info.plist'),
      '<key>UIBackgroundModes</key><array><string>remote-notification</string></array>' +
        '<key>NSCameraUsageDescription</key><string>From the plugin</string>',
    )
    writeFileSync(
      join(appDirectory, 'ios/App.entitlements'),
      '<key>aps-environment</key><string>production</string>',
    )
    writeFileSync(join(appDirectory, 'ios/chime.wav'), 'sound')

    link()

    const fontPlugin = {
      name: 'fonts',
      resources: [{ source: './assets/Inter-Bold.ttf', font: true, android: false }],
    }
    writeFileSync(join(appDirectory, 'ios/Inter-Bold.ttf'), 'font')

    const targetPlugin = {
      name: 'targets',
      ios: { targets: (targets) => targets.push({ name: 'NotificationService' }) },
    }

    assert.throws(
      () => link({ plugins: [targetPlugin] }),
      /project\.pbxproj: an extension target named NotificationService/,
    )
    assert.throws(
      () => link({ plugins: [fontPlugin] }),
      /Info\.plist: <key>UIAppFonts<\/key> = \["Inter-Bold\.ttf"\]/,
    )
  })

  test("copies the app's and the plugins' resources", (appDirectory) => {
    run(appDirectory)

    const resources = 'android/app/src/main/res'

    assert.strictEqual(read(appDirectory, 'ios/App/Resources/chime.wav'), 'sound')
    assert.strictEqual(read(appDirectory, 'ios/App/Resources/Inter-Bold.ttf'), 'font')
    assert.strictEqual(read(appDirectory, `${resources}/raw/chime.wav`), 'sound')
    assert.strictEqual(read(appDirectory, `${resources}/font/inter_bold.ttf`), 'font')
    assert.match(read(appDirectory, 'ios/Info.plist'), /<key>UIAppFonts<\/key>/)

    const fontPlugin = {
      name: 'fonts',
      resources: [{ source: './assets/Inter-Bold.ttf', font: true, android: false }],
    }
    run(appDirectory, { plugins: [fontPlugin] })

    assert.strictEqual(read(appDirectory, 'ios/Info.plist').match(/Inter-Bold\.ttf/g).length, 1)
  })

  test('refuses resources Android or Gradle would', (appDirectory) => {
    const plugin = { name: 'sounds', resources: [{ source: './sounds/missing.wav' }] }
    const config = {
      ...CONFIG,
      resources: [
        { source: './assets/Inter-Bold.ttf', android: { type: 'raw' } },
        { source: './sounds/chime.wav', ios: { destination: '..' }, android: false },
        { source: './sounds/chime.wav', ios: false, android: { type: 'assets', name: '' } },
      ],
      android: {
        ...CONFIG.android,
        gradle: {
          repositories: ['http://example.com'],
          plugins: [{ id: 'com.google.gms.google-services', version: 4.4 }],
        },
      },
    }
    const problems = [
      "resources[0].android.name: lowercase letters, digits and underscores, not a Java keyword, e.g. 'inter_bold'",
      'resources[1].ios.destination:',
      'resources[2].android.name:',
      "sounds's resources[0].source: ./sounds/missing.wav isn't a file",
      'android.gradle.repositories:',
      'android.gradle.plugins:',
    ]
    const stringPlugin = {
      name: 'string',
      android: { gradle: (gradle) => gradle.plugins.push('com.google.gms.google-services') },
    }
    const unset = { ...CONFIG.android, gradle: { dependencies: undefined } }

    assert.throws(
      () => run(appDirectory, { config, plugins: [plugin] }),
      (error) => problems.every((problem) => error.message.includes(problem)),
    )
    assert.throws(
      () => run(appDirectory, { plugins: [stringPlugin] }),
      /the plugins' gradle mods' result\.plugins:/,
    )
    run(appDirectory, { config: { ...CONFIG, android: unset } })
  })

  test("embeds the plugins' and native/extensions' extension targets", (appDirectory) => {
    const serviceSources = join(appDirectory, 'push-extension')
    const widgetSources = join(appDirectory, 'native/extensions/Widget')
    const extensionPlugin = {
      name: 'push-extension',
      ios: {
        targets(targets) {
          targets.push({
            name: 'NotificationService',
            type: 'notification-service',
            sources: serviceSources,
            bundleIdSuffix: '.NotificationService',
            infoPlist: {
              NSExtension: {
                NSExtensionPrincipalClass: '$(PRODUCT_MODULE_NAME).NotificationService',
              },
            },
            appGroups: true,
          })
        },
      },
    }
    const ios = { ...CONFIG.ios, appGroups: ['group.com.example.tomsapp'] }

    mkdirSync(serviceSources)
    mkdirSync(widgetSources, { recursive: true })
    writeFileSync(join(serviceSources, 'NotificationService.swift'), '')
    writeFileSync(
      join(widgetSources, 'nativue.json'),
      '{ "ios": { "target": { "type": "widget", "bundleIdSuffix": ".Widget" } } }',
    )
    run(appDirectory, { config: { ...CONFIG, ios }, plugins: [PUSH_PLUGIN, extensionPlugin] })

    checkSnapshots(appDirectory, {
      'extension.project.pbxproj': 'ios/App.xcodeproj/project.pbxproj',
      'extension.Info.plist': 'ios/ExtensionSupport/NotificationService/Info.plist',
    })
    assert.strictEqual(
      readlinkSync(join(appDirectory, 'ios/Extensions/NotificationService')),
      '../../push-extension',
    )
    assert.ok(isPresent(appDirectory, 'ios/Extensions/Widget/nativue.json'))
    assert.match(
      read(
        appDirectory,
        'ios/ExtensionSupport/NotificationService/NotificationService.entitlements',
      ),
      /group\.com\.example\.tomsapp/,
    )
    assert.match(read(appDirectory, 'ios/App.entitlements'), /group\.com\.example\.tomsapp/)
    assert.ok(!isPresent(appDirectory, 'ios/ExtensionSupport/Widget/Widget.entitlements'))
    assert.deepStrictEqual(
      run(appDirectory, { config: { ...CONFIG, ios }, plugins: [PUSH_PLUGIN, extensionPlugin] }),
      [],
    )
  })

  test('refuses an extension target iOS would', (appDirectory) => {
    const target = (fields) => ({
      type: 'widget',
      sources: '.',
      bundleIdSuffix: '.Widget',
      ...fields,
    })
    const badPlugin = {
      name: 'bad',
      ios: {
        targets(targets) {
          targets.push(
            { name: 'App', type: 'clip', sources: './nowhere', bundleIdSuffix: 'x' },
            target({ name: 'Widget' }),
            target({ name: 'widget' }),
            target({ name: 'NativuePlugins' }),
            target({ name: 'Shared', appGroups: true }),
          )
        },
      },
    }
    const problems = [
      'ios target App.name:',
      'ios target App.sources:',
      'ios target App.type:',
      'ios target App.bundleIdSuffix:',
      'ios target widget.name:',
      'ios target NativuePlugins.name:',
      "ios target Shared.appGroups: shares ios.appGroups, which nativue.config.ts doesn't set",
    ]

    assert.throws(
      () => run(appDirectory, { plugins: [badPlugin] }),
      (error) =>
        problems.every((problem) => error.message.includes(problem)) &&
        !error.message.includes('ios target Widget.name:'),
    )

    mkdirSync(join(appDirectory, 'native/extensions/Widget'), { recursive: true })

    assert.throws(() => run(appDirectory), /native\/extensions\/Widget needs a nativue\.json/)

    writeFileSync(join(appDirectory, 'native/extensions/Widget/nativue.json'), '{ "ios": ')

    assert.throws(() => run(appDirectory), /native\/extensions\/Widget\/nativue\.json: /)
  })

  test('tells an app from before prebuild about prebuild: false before any config field', (appDirectory) => {
    mkdirSync(join(appDirectory, 'ios/App'), { recursive: true })
    mkdirSync(join(appDirectory, 'android/app'), { recursive: true })
    writeFileSync(join(appDirectory, 'ios/App/App.swift'), '')
    writeFileSync(join(appDirectory, 'android/app/build.gradle.kts'), '')

    assert.throws(
      () => run(appDirectory, { config: {} }),
      (error) =>
        error.message.startsWith("ios/ and android/ weren't generated by nativue") &&
        error.message.includes('defineConfig({ prebuild: false })') &&
        !error.message.includes('invalid fields'),
    )
  })

  test('says where a hand edit belongs', (appDirectory) => {
    run(appDirectory)
    writeFileSync(join(appDirectory, 'ios/Info.plist'), 'edited')

    assert.throws(() => run(appDirectory), /Info\.plist {2}→ ios\.infoPlist/)
  })

  test('lists every invalid config field at once', (appDirectory) => {
    const config = {
      name: '',
      scheme: 'my app',
      version: '1.2',
      buildNumber: 0,
      ios: { infoPlist: { UIBackgroundModes: null } },
      android: {
        package: 'com.my-app',
        permissions: ['CAMERA'],
        signing: { storeFile: './android/upload.keystore' },
      },
    }
    const fields = [
      'name:',
      'scheme:',
      'version:',
      'buildNumber:',
      'ios.bundleIdentifier:',
      'ios.infoPlist:',
      'android.package:',
      'android.permissions:',
      'android.signing.storeFile:',
      'android.signing.keyPasswordEnv:',
    ]

    assert.throws(
      () => prebuild({ config, appDirectory, coreDirectory: CORE_DIRECTORY }),
      (error) => fields.every((field) => error.message.includes(field)),
    )
  })

  await asyncTest(
    "finds packages' plugins, replaced by the config's of the same name",
    async (appDirectory) => {
      const writePackage = (name, plugin, file = 'plugin.mjs') => {
        const directory = join(appDirectory, 'node_modules', name)
        const manifest = { name, nativue: { plugin: `./${file}` } }

        mkdirSync(directory, { recursive: true })
        writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest))
        writeFileSync(join(directory, file), plugin)
      }
      const writeDependencies = (names) => {
        const dependencies = Object.fromEntries(names.map((name) => [name, '1.0.0']))

        writeFileSync(join(appDirectory, 'package.json'), JSON.stringify({ dependencies }))
      }

      writePackage(
        'nativue-push',
        "export default (options = {}) => ({ name: 'nativue-push', options })",
      )
      writePackage('nativue-photos', "export default async () => ({ name: 'nativue-photos' })")
      writeDependencies(['nativue-push', 'nativue-photos'])

      assert.deepStrictEqual(await resolvePlugins(appDirectory), [
        { name: 'nativue-push', options: {} },
        { name: 'nativue-photos' },
      ])

      // A required option: the package's plugin is never created without it.
      writePackage(
        'nativue-maps',
        "export default ({ apiKey }) => { if (!apiKey) throw new Error('apiKey'); return { name: 'nativue-maps' } }",
      )
      writeDependencies(['nativue-push', 'nativue-photos', 'nativue-maps'])
      const configured = await resolvePlugins(appDirectory, [
        { name: 'nativue-push', options: { exactAlarms: true } },
        { name: 'nativue-maps' },
      ])

      assert.deepStrictEqual(
        configured.map((plugin) => plugin.name),
        ['nativue-photos', 'nativue-push', 'nativue-maps'],
      )
      assert.deepStrictEqual(configured[1].options, { exactAlarms: true })

      // Another file: Node keeps the module it imported first.
      writePackage('nativue-photos', "export default () => ({ name: 'photos' })", 'renamed.mjs')
      await assert.rejects(
        resolvePlugins(appDirectory, [{ name: 'nativue-maps' }]),
        /must export by default a function returning \{ name: 'nativue-photos'/,
      )
    },
  )
} finally {
  appDirectories.forEach((directory) => rmSync(directory, { recursive: true, force: true }))
}
