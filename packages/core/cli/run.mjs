// `nativue run ios | android [--device [name or id]]`: builds the app's debug build, opens a simulator
// or emulator when none is running, then installs and launches the app on it. `--device` picks one by
// name or id (a simulator, an emulator or a phone), or alone, the first phone connected.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const IOS_BUILD_DIRECTORY = 'ios/build'
const iOSAppPath = (sdk) => `${IOS_BUILD_DIRECTORY}/Build/Products/Debug-${sdk}/App.app`
const BOOT_POLL_INTERVAL_MS = 2000

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', ...options })
}

function step(message) {
  console.log(`\n› ${message}`)
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

// ---------- iOS ----------

const iOSVersion = (device) => Number(device.runtime.match(/iOS-(\d+)/)?.[1] ?? 0)

/** iOS simulators, the newest iOS first. */
function simulators() {
  const { devices } = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', 'available', '-j']))

  return Object.entries(devices)
    .flatMap(([runtime, runtimeDevices]) =>
      runtimeDevices.map((device) => ({ ...device, runtime })),
    )
    .filter(iOSVersion)
    .sort((first, second) => iOSVersion(second) - iOSVersion(first))
}

const iPhoneSimulators = () => simulators().filter((device) => device.name.startsWith('iPhone'))

/** An iPhone on the newest iOS: one already booted if there is one. */
function defaultSimulator() {
  const iPhones = iPhoneSimulators()

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

/** iPhones and iPads paired with this Mac, by Xcode's devicectl. */
function physicalIOSDevices() {
  const outputFile = join(tmpdir(), `nativue-devices-${process.pid}.json`)

  try {
    run('xcrun', ['devicectl', 'list', 'devices', '--json-output', outputFile], { stdio: 'ignore' })
    const { result } = JSON.parse(readFileSync(outputFile, 'utf8'))

    return result.devices
      .filter((device) => device.hardwareProperties.reality === 'physical')
      .map((device) => ({
        name: device.deviceProperties.name,
        udid: device.hardwareProperties.udid,
      }))
  } finally {
    rmSync(outputFile, { force: true })
  }
}

/** `--device` alone: the first phone. `--device <name or id>`: that simulator or phone. */
function pickIOSDevice(requested) {
  if (requested === undefined) return { ...defaultSimulator(), isSimulator: true }

  const phones = physicalIOSDevices().map((device) => ({ ...device, isSimulator: false }))
  if (requested === true) {
    if (phones.length === 0) throw new Error('No iPhone connected: plug it in and trust this Mac.')

    return phones[0]
  }

  const candidates = [
    ...phones,
    ...simulators().map((device) => ({ ...device, isSimulator: true })),
  ]
  const device = candidates.find(({ name, udid }) => name === requested || udid === requested)
  if (!device) throw new Error(noDeviceMessage(requested, suggestedIOSDevices(phones)))

  return device
}

/** The phones, and the iPhone simulators on the newest iOS: the whole list runs long. */
function suggestedIOSDevices(phones) {
  const iPhones = iPhoneSimulators()
  const newestIPhones = iPhones.filter((device) => iOSVersion(device) === iOSVersion(iPhones[0]))

  return [...phones, ...newestIPhones].map(({ name, udid }) => `${name} (${udid})`)
}

function noDeviceMessage(requested, available) {
  return `No device named or with the id "${requested}". Available:\n  ${available.join('\n  ')}`
}

function buildIOSApp(destination, isSimulator) {
  step('Building the iOS app')

  try {
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
        `id=${destination}`,
        '-derivedDataPath',
        IOS_BUILD_DIRECTORY,
        // A phone needs a signed app: Xcode creates its provisioning profile.
        ...(isSimulator ? [] : ['-allowProvisioningUpdates']),
        '-quiet',
        'build',
      ],
      { stdio: 'inherit' },
    )
  } catch (error) {
    if (isSimulator) throw error

    throw new Error(
      'The build for the phone failed. If it says signing needs a development team, open ios/App.xcodeproj in Xcode and pick your team under Signing & Capabilities.',
    )
  }
}

function bundleIdentifier(appPath) {
  return run('plutil', ['-extract', 'CFBundleIdentifier', 'raw', `${appPath}/Info.plist`]).trim()
}

export function runOnIOS({ device: requested } = {}) {
  const device = pickIOSDevice(requested)

  if (device.isSimulator && device.state !== 'Booted') {
    step(`Booting ${device.name}`)
    run('xcrun', ['simctl', 'boot', device.udid])
  }
  if (device.isSimulator) openSimulatorApp()

  buildIOSApp(device.udid, device.isSimulator)

  const appPath = iOSAppPath(device.isSimulator ? 'iphonesimulator' : 'iphoneos')
  const bundleId = bundleIdentifier(appPath)
  step(`Opening ${bundleId} on ${device.name}`)

  if (device.isSimulator) {
    run('xcrun', ['simctl', 'install', device.udid, appPath])
    run('xcrun', ['simctl', 'launch', device.udid, bundleId])
    return
  }

  const devicectl = (subcommand, ...args) =>
    run('xcrun', ['devicectl', 'device', ...subcommand, '--device', device.udid, ...args], {
      stdio: 'ignore',
    })

  devicectl(['install', 'app'], appPath)
  devicectl(['process', 'launch'], '--terminate-existing', bundleId)
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

/** Serials and models of what adb sees: emulators and phones. */
function connectedDevices(adb) {
  return run(adb, ['devices', '-l'])
    .split('\n')
    .filter((line) => /\sdevice\s/.test(`${line} `))
    .map((line) => ({ serial: line.split(/\s+/)[0], model: line.match(/model:(\S+)/)?.[1] ?? '' }))
}

const isEmulator = (serial) => serial.startsWith('emulator-')

/** `--device` alone: the first phone. `--device <serial or model>`: that one. */
function pickRequestedDevice(adb, requested) {
  const devices = connectedDevices(adb)

  if (requested === true) {
    const phone = devices.find(({ serial }) => !isEmulator(serial))
    if (!phone) throw new Error('No Android phone connected: plug it in with USB debugging on.')

    return phone.serial
  }

  const device = devices.find(({ serial, model }) => serial === requested || model === requested)
  if (!device)
    throw new Error(
      noDeviceMessage(
        requested,
        devices.map(({ serial, model }) => `${model} (${serial})`),
      ),
    )

  return device.serial
}

async function pickDevice(sdkPath, adb, requested) {
  if (requested !== undefined) return pickRequestedDevice(adb, requested)

  const [device] = connectedDevices(adb)
  if (device) return device.serial

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

  return connectedDevices(adb)[0].serial
}

function applicationId() {
  const gradleFile = readFileSync('android/app/build.gradle.kts', 'utf8')

  return gradleFile.match(/applicationId\s*=\s*"([^"]+)"/)[1]
}

export async function runOnAndroid({ device: requested, port } = {}) {
  const sdkPath = androidSdkPath()
  const adb = `${sdkPath}/platform-tools/adb`
  const device = await pickDevice(sdkPath, adb, requested)

  // A phone on USB reaches the dev server on this computer through adb, whatever its network.
  if (!isEmulator(device)) run(adb, ['-s', device, 'reverse', `tcp:${port}`, `tcp:${port}`])

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
