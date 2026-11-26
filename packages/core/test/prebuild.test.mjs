// nativue prebuild on a throwaway app: the generated files against snapshots (UPDATE_SNAPSHOTS=1
// rewrites them), idempotency, and every way a hand edit stops it.
import assert from 'node:assert'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  },
}
const MANUAL_CONFIG = { prebuild: false }

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

  return appDirectory
}

function run(appDirectory, options = {}) {
  return prebuild({ config: CONFIG, appDirectory, coreDirectory: CORE_DIRECTORY, ...options })
}

const read = (appDirectory, path) => readFileSync(join(appDirectory, path), 'utf8')
const isPresent = (appDirectory, path) =>
  lstatSync(join(appDirectory, path), { throwIfNoEntry: false }) !== undefined

/** The core's path, relative to the temporary app, differs between machines. */
function withoutCorePath(text) {
  return text.replaceAll(/(\.\.\/)+[^"]*?packages\/core/g, '__CORE_PATH__')
}

function checkSnapshots(appDirectory) {
  for (const [snapshot, path] of Object.entries(SNAPSHOTS)) {
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
    prebuild({ config: renamed, appDirectory: renamedApp, coreDirectory: CORE_DIRECTORY })
    const pending = JSON.parse(
      readFileSync(join(renamedApp, 'ios/.nativue/generated.json'), 'utf8'),
    )

    // As if it stopped after the pending record and one of the new files.
    writeFileSync(recordPath, JSON.stringify({ ...finished, pending: pending.files }))
    writeFileSync(join(appDirectory, 'ios/Info.plist'), read(renamedApp, 'ios/Info.plist'))

    const written = prebuild({ config: renamed, appDirectory, coreDirectory: CORE_DIRECTORY })

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
    mkdirSync(join(appDirectory, 'assets'))
    writeFileSync(join(appDirectory, 'assets/icon.png'), png(1024, 1024))
    writeFileSync(join(appDirectory, 'assets/splash.png'), png(360, 360))
    const config = {
      ...CONFIG,
      icon: './assets/icon.png',
      splash: { image: './assets/splash.png' },
    }

    prebuild({ config, appDirectory, coreDirectory: CORE_DIRECTORY })

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
    mkdirSync(join(appDirectory, 'assets'))
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

    prebuild({ config, appDirectory, coreDirectory: CORE_DIRECTORY })

    const infoPlist = read(appDirectory, 'ios/Info.plist')
    assert.match(infoPlist, /NSAllowsLocalNetworking/)
    assert.match(infoPlist, /api\.example\.com/)
    assert.match(infoPlist, /<string>tomsapp<\/string>/)
    assert.match(infoPlist, /com\.googleusercontent\.apps\.123/)
    assert.match(read(appDirectory, 'android/app/build.gradle.kts'), /keyAlias = "my\\\$\\"key"/)
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
} finally {
  appDirectories.forEach((directory) => rmSync(directory, { recursive: true, force: true }))
}
