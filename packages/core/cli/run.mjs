// `nativue run ios | android`: builds the app's debug build, opens a simulator or emulator when none
// is running, then installs and launches the app on it.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'

const IOS_BUILD_DIRECTORY = 'ios/build'
const IOS_APP_PATH = `${IOS_BUILD_DIRECTORY}/Build/Products/Debug-iphonesimulator/App.app`
const BOOT_POLL_INTERVAL_MS = 2000

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', ...options })
}

function step(message) {
  console.log(`\n› ${message}`)
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

// ---------- iOS ----------

function simulators() {
  const { devices } = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', 'available', '-j']))

  return Object.entries(devices).flatMap(([runtime, runtimeDevices]) =>
    runtimeDevices.map((device) => ({ ...device, runtime })),
  )
}

/** An iPhone, the newest iOS first: one already booted if there is one. */
function pickSimulator() {
  const iOSVersion = (device) => Number(device.runtime.match(/iOS-(\d+)/)?.[1] ?? 0)
  const iPhones = simulators()
    .filter((device) => device.name.startsWith('iPhone') && iOSVersion(device))
    .sort((first, second) => iOSVersion(second) - iOSVersion(first))

  if (iPhones.length === 0)
    throw new Error('No iPhone simulator found: add one in Xcode > Settings > Components.')

  return iPhones.find((device) => device.state === 'Booted') ?? iPhones[0]
}

// Simulator.app up to Xcode 26; Xcode 27 shows simulators in its DeviceHub app.
const SIMULATOR_APP_BUNDLE_IDS = ['com.apple.iphonesimulator', 'com.apple.dt.Devices']

/** Brings up the window that shows the simulator; the app runs on it either way. */
function openSimulatorApp() {
  for (const bundleId of SIMULATOR_APP_BUNDLE_IDS) {
    try {
      return run('open', ['-b', bundleId], { stdio: 'ignore' })
    } catch {
      // not installed with this Xcode: try the next one
    }
  }
}

export function runOnIOS() {
  const simulator = pickSimulator()

  if (simulator.state !== 'Booted') {
    step(`Booting ${simulator.name}`)
    run('xcrun', ['simctl', 'boot', simulator.udid])
  }
  openSimulatorApp()

  step('Building the iOS app')
  run(
    'xcodebuild',
    [
      '-project',
      'ios/App.xcodeproj',
      '-scheme',
      'App',
      '-configuration',
      'Debug',
      '-destination',
      `id=${simulator.udid}`,
      '-derivedDataPath',
      IOS_BUILD_DIRECTORY,
      '-quiet',
      'build',
    ],
    { stdio: 'inherit' },
  )

  const bundleId = run('plutil', [
    '-extract',
    'CFBundleIdentifier',
    'raw',
    `${IOS_APP_PATH}/Info.plist`,
  ]).trim()

  step(`Opening ${bundleId} on ${simulator.name}`)
  run('xcrun', ['simctl', 'install', simulator.udid, IOS_APP_PATH])
  run('xcrun', ['simctl', 'launch', simulator.udid, bundleId])
}

// ---------- Android ----------

function androidSdkPath() {
  const defaultPath = {
    darwin: `${homedir()}/Library/Android/sdk`,
    linux: `${homedir()}/Android/Sdk`,
    win32: `${process.env.LOCALAPPDATA}\\Android\\Sdk`,
  }[process.platform]
  const sdkPath = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? defaultPath

  if (!existsSync(sdkPath))
    throw new Error('Android SDK not found: install Android Studio, or set ANDROID_HOME.')

  return sdkPath
}

/** Gradle needs a JDK: without JAVA_HOME, the one inside Android Studio. */
function javaHome() {
  if (process.env.JAVA_HOME) return process.env.JAVA_HOME

  const androidStudioJdk = {
    darwin: '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
    linux: '/opt/android-studio/jbr',
    win32: 'C:\\Program Files\\Android\\Android Studio\\jbr',
  }[process.platform]

  return existsSync(androidStudioJdk) ? androidStudioJdk : undefined
}

function connectedDevices(adb) {
  return run(adb, ['devices'])
    .split('\n')
    .filter((line) => line.endsWith('\tdevice'))
    .map((line) => line.split('\t')[0])
}

// ponytail: the first device or emulator wins; a --device option when people run several at once.
async function pickDevice(sdkPath, adb) {
  const [device] = connectedDevices(adb)
  if (device) return device

  const emulator = `${sdkPath}/emulator/emulator`
  const [emulatorName] = run(emulator, ['-list-avds']).split('\n').filter(Boolean)
  if (!emulatorName)
    throw new Error('No Android emulator found: create one in Android Studio > Device Manager.')

  step(`Starting the ${emulatorName} emulator`)
  spawn(emulator, ['-avd', emulatorName], { detached: true, stdio: 'ignore' }).unref()
  run(adb, ['wait-for-device'])

  while (run(adb, ['shell', 'getprop', 'sys.boot_completed']).trim() !== '1') {
    await sleep(BOOT_POLL_INTERVAL_MS)
  }

  return connectedDevices(adb)[0]
}

function applicationId() {
  const gradleFile = readFileSync('android/app/build.gradle.kts', 'utf8')

  return gradleFile.match(/applicationId\s*=\s*"([^"]+)"/)[1]
}

export async function runOnAndroid() {
  const sdkPath = androidSdkPath()
  const adb = `${sdkPath}/platform-tools/adb`
  const device = await pickDevice(sdkPath, adb)

  step('Building the Android app')
  const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew'
  run(gradlew, ['installDebug', '-q'], {
    cwd: 'android',
    stdio: 'inherit',
    env: { ...process.env, ANDROID_HOME: sdkPath, ANDROID_SERIAL: device, JAVA_HOME: javaHome() },
  })

  const appId = applicationId()
  const launcherActivity = run(adb, [
    '-s',
    device,
    'shell',
    'cmd',
    'package',
    'resolve-activity',
    '--brief',
    '-c',
    'android.intent.category.LAUNCHER',
    appId,
  ])
    .trim()
    .split('\n')
    .at(-1)

  step(`Opening ${appId} on ${device}`)
  run(adb, ['-s', device, 'shell', 'am', 'start', '-n', launcherActivity])
}
