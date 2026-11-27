# RFC: the foundation for native packages

**Status:** approved on 2026-11-26 (revision 4).

Decisions:

- **ios/ and android/ are generated (prebuild)**;
- **nativue.config.ts holds the whole app config**;
- Android relies on the **manifest merger**;
- generation is **idempotent because it always starts from the template**;
- **scaffolding comes last**.

Every Apple or Google minimum version or policy cited here links to the official page it was checked
against on 2026-11-26.

## Context

The next packages (notifications, secure-store, image-picker, camera, file-system, auth-session)
need things today's packages (haptics, sqlite, clipboard) never did: Info.plist usage descriptions,
entitlements, manifest entries, AppDelegate/Activity callbacks, native→JS events, a permission
model, extension targets and bundled resources. This RFC audits what exists, then builds each missing
piece once, so every package doesn't reinvent it.

## Phase 1: audit

| #   | Item                      | State                                                                                                                                                                                                                                                                                                                                              | Where                                                                                                                            |
| --- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | App config file           | **Partial.** `nativue.config.ts` + `defineConfig` exist and are typed, but hold only `plugins` (Vite plugins and a runtime module). Name, ids and version live in `project.pbxproj` / `build.gradle.kts`; icon and splash are assets; permissions are edited by hand.                                                                              | `packages/core/cli/config.d.mts`, `config.mjs`, `nativue.mjs` (`loadAppConfig`)                                                  |
| 2   | Native project generation | **Missing.** `create-nativue` copies `template/` once and fills `__PLACEHOLDERS__`. After that, ios/ and android/ are committed and edited by hand. Only `ios/NativuePlugins` is regenerated. The template's pbxproj already uses Xcode 16 buildable folders (`objectVersion = 77`) and fixed object ids.                                          | `packages/create-nativue/index.mjs`, `template/ios`, `template/android`                                                          |
| 3   | Config plugins            | **Missing.** A package can't change Info.plist, entitlements, the manifest, Gradle files or strings.xml. Podfile: not applicable (SwiftPM only; Swift dependencies go in `nativue.ios.dependencies`). Gradle's manifest merger is available but unused.                                                                                            | —                                                                                                                                |
| 4   | Autolinking               | **Exists.** iOS: on dev/build/run the CLI writes `ios/NativuePlugins` (one SwiftPM target per package, symlinked sources, the `nativuePlugins` list). Android: `nativue.settings.gradle.kts` adds each package as a Gradle module, with plugin classes in the `nativue_plugins` string resource. `native/<name>/` works too.                       | `packages/core/cli/link.mjs`, `packages/core/android/nativue.settings.gradle.kts`, `ios/Plugins.swift`, `android/.../Plugins.kt` |
| 5   | Lifecycle events          | **Missing.** iOS has no AppDelegate (a SwiftUI `App` whose `.onOpenURL` only feeds the router). Android's `NativueActivity` extends plain `Activity`: no `ActivityResultRegistry`, `onNewIntent` only feeds the router. A new `Bridge`, plugin registry and plugin instances are created on every `onCreate`.                                      | template `ios/App/App.swift`, `ios/NativueView.swift`, `android/.../NativueActivity.kt`, `android/.../Bridge.kt`                 |
| 6   | Permissions               | **Missing.**                                                                                                                                                                                                                                                                                                                                       | —                                                                                                                                |
| 7   | Module API conventions    | **Partial.** Sync functions (`addFunction`, JS thread) and async ones (`addAsyncFunction`, Promise) exist and are documented; views send events with `sendEvent`. **Missing:** module events, error codes, composables.                                                                                                                            | `ios/Plugins.swift`, `android/.../Plugins.kt`, `src/native-functions.ts`                                                         |
| 8   | Scaffolding               | **Missing.**                                                                                                                                                                                                                                                                                                                                       | `docs/packages.md`                                                                                                               |
| 9   | Tests and CI              | **Partial.** `core/test/test.mjs` runs the demo bundle against a fake `__native`; sqlite has statement tests. **There is no** `.github/workflows`, no native build in CI and no JS mocks.                                                                                                                                                          | `packages/core/test/test.mjs`, `packages/sqlite/test/`                                                                           |
| 10  | Publishing                | **Exists, informal.** Each package has its own version, released with a manual `chore: release x.y.z` commit (feat → minor, fix → patch). Packages peer-depend on `@nativue/core: ">=0.x"`. Minimums: iOS 15.1, Android minSdk 24 / compileSdk 37. Docs: a README per package, a table in `docs/packages.md`, a line in `packages/core/AGENTS.md`. | `packages/*/package.json`, `docs/packages.md`                                                                                    |
| —   | Signing                   | **Partial.** `nativue run` finds the Apple team when only one certificate exists and passes `DEVELOPMENT_TEAM` to `xcodebuild`; otherwise the user picks it in Xcode, which edits the pbxproj. Android release signing isn't covered; apps edit `build.gradle.kts` by hand.                                                                        | `packages/core/cli/run.mjs` (`signingSettings`)                                                                                  |

## Phase 2: design

### A. App config (`nativue.config.ts`)

```ts
import { defineConfig } from '@nativue/core/config'
import notifications from '@nativue/notifications/plugin'

export default defineConfig({
  name: 'My App',
  version: '1.2.0', // CFBundleShortVersionString / versionName
  buildNumber: 12, // CFBundleVersion / versionCode
  scheme: 'myapp',
  icon: './assets/icon.png', // 1024×1024 PNG
  splash: {
    image: './assets/splash.png',
    backgroundColor: '#F1F5F9',
    darkBackgroundColor: '#0B1220',
  },
  resources: [{ source: './assets/chime.wav', android: { type: 'raw' } }], // §K
  ios: {
    bundleIdentifier: 'com.company.myapp',
    appleTeamId: process.env.APPLE_TEAM_ID, // §I
    appGroups: ['group.com.company.myapp'], // §J
    infoPlist: { NSCameraUsageDescription: 'Scan receipts' },
    entitlements: {},
  },
  android: {
    package: 'com.company.myapp',
    permissions: ['android.permission.CAMERA'],
    blockedPermissions: ['android.permission.READ_MEDIA_IMAGES'],
    adaptiveIcon: { foregroundImage: './assets/adaptive.png', backgroundColor: '#0B1220' },
    signing: {
      // §I
      storeFile: './credentials/upload.keystore',
      keyAlias: 'upload',
      storePasswordEnv: 'ANDROID_STORE_PASSWORD',
      keyPasswordEnv: 'ANDROID_KEY_PASSWORD',
    },
    gradle: { dependencies: [], manifestPlaceholders: {} }, // §L
  },
  plugins: [notifications({ androidIconColor: '#10B39B' })],
  // prebuild: false  → §B4
})
```

- **No image processing.**
  - iOS: a single-size 1024×1024 icon, from which Xcode 14+ derives the other sizes ([Xcode 14 notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-14-release-notes)). Those notes warn that validation can fail below iOS 12; our minimum is 15.1.
  - Android: the PNG goes into `mipmap-xxxhdpi` / `drawable-xxxhdpi`.
  - Splash: uses the template's existing assets and theme items.
- **Validation:** the config is checked before anything is written, and all problems are reported in one error.

### B. Prebuild

#### B1. Generation

- **Template location:** it moves to `packages/core/template/{ios,android}`. `create-nativue` keeps only the JS app, and its gitignore now lists `ios/`, `android/` and `credentials/`.
- **Command:** `nativue prebuild [ios|android] [--force]`.
- **Steps:**
  1. Load the config.
  2. Build every output file **in memory**:
     - copy the template and fill its placeholders (`fillPlaceholders` moves to core, plus a new `__CORE_PATH__`);
     - **generate `project.pbxproj` from a JS model** (§J);
     - build the base Info.plist, entitlements, manifest and strings from the config;
     - render the Gradle markers (§L);
     - run the mods (§C) and copy the resources (§K);
     - write the linking output.
  3. Check the folder (§B2).
  4. Write only the files that changed, and delete the generated files that are gone.
  5. Write the record last.
- **Idempotent by construction:** every run starts from the template. A test runs it twice and compares the bytes.
- **Demo:** `examples/demo/ios` and `android` leave git. `.claude/rules/app-template.md` is rewritten.

#### B2. Protection against overwriting manual edits

**The record.** `ios/.nativue/generated.json` and `android/.nativue/generated.json` hold the core
version and the SHA-256 of every generated file (for a symlink, of its target path). This file is
also the marker that says "this folder was generated".

**Paths nativue never checks or deletes**, because tools own them: `ios/build`, `ios/App/main.bundle.js`,
`xcuserdata/`, `.DS_Store`, `*.xcworkspace/xcshareddata/swiftpm/` (`Package.resolved` is seeded only
when missing), `android/.gradle`, `android/.kotlin`, `android/build`, `android/app/build`,
`android/app/.cxx`, `android/local.properties`, `android/.idea`, `*.iml`, and the Android bundle asset.
While walking the folders, nativue skips these directories instead of entering them. The final list
is checked during implementation: generate, open the project in Xcode and Android Studio, build, and
see what new files appeared.

**Each case stops with an error before any file is written:**

| Folder state                                                                       | Result                                                                              |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Missing, or holding only the paths above (fresh clone, CI, a restored build cache) | Generated, no error                                                                 |
| Has files but no record (an app from before prebuild)                              | Error with a link to `docs/migrating-to-prebuild.md`. Nothing is touched.           |
| A generated file whose hash differs from the record                                | Error with the diff and where the change belongs                                    |
| A file nativue never generated                                                     | Error: it would be left out of the build without anyone noticing                    |
| `--force`                                                                          | Generated files are overwritten and unknown files are deleted; the paths above stay |

**The diff** compares the file on disk with the last generated version, regenerated in memory. It
uses `git diff --no-index --color`; if git is missing, it lists the changed files instead.

**Where each change belongs.** Every message points to one destination, with a snippet to paste when
nativue can work one out:

| Change found                                                            | Destination                                                          | Snippet                                                                                                  |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `DEVELOPMENT_TEAM` in the pbxproj (the team picked in Xcode)            | `ios.appleTeamId`                                                    | `ios: { appleTeamId: 'ABCDE12345' }`, or `process.env.APPLE_TEAM_ID` when the team differs per developer |
| A capability added in Xcode (pbxproj + `App.entitlements`)              | `ios.entitlements` / `ios.appGroups`                                 | the entitlement keys and values                                                                          |
| A key in `Info.plist`                                                   | `ios.infoPlist`                                                      | the key and value (read with `plutil -convert json`)                                                     |
| `<uses-permission>` added or removed                                    | `android.permissions` / `android.blockedPermissions`                 | the array entry                                                                                          |
| `signingConfigs` in `build.gradle.kts`                                  | `android.signing`                                                    | the object, with passwords replaced by env variable names                                                |
| `dependencies`, `plugins`, `manifestPlaceholders`, `buildConfigField`   | `android.gradle`                                                     | the structured entry                                                                                     |
| `versionCode`, `applicationId`, display name, bundle id                 | the top-level field                                                  | the field and value                                                                                      |
| A new target in the pbxproj                                             | an extension target (§J)                                             | a link to the guide                                                                                      |
| A new `.swift` / `.kt` / `.java` file                                   | a module in `native/<name>/`                                         | the target path                                                                                          |
| A new file of any other kind (sound, font, `GoogleService-Info.plist`…) | `resources` in the config, or `context.addResource` in a plugin (§K) | the `resources` entry                                                                                    |
| Anything else                                                           | a local config plugin                                                | a link to the plugin guide, with the right mod                                                           |

**Crash safety.** Before writing, nativue saves the record with both the old and the new hashes
(`pending`), and a file matching either one is accepted. A prebuild that stops halfway can't leave
an "edited file" error behind.

**CI.** ios/ and android/ are gitignored, so a checkout has neither folder and they're generated
without checks. A cache restored into `ios/build` or `android/.gradle` before prebuild contains only
ignored paths, so the folder still counts as empty. The CI workflow (§H) does exactly that.

#### B3. No fingerprint: prebuild runs every time

`dev`, `build` and `run` always run prebuild, because a TS config can read `process.env`. Measured on
the demo (Apple Silicon, 3 runs):

| Step                                                             | Time                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------ |
| Loading `nativue.config.ts`                                      | 11–102 ms (the CLI already does this on every command) |
| Reading and hashing the template (37 files)                      | 2–7 ms                                                 |
| Walking and hashing ios/ and android/ (43 files, caches skipped) | ~3 ms                                                  |
| Same walk entering `ios/build` (1.2 GB)                          | >100 ms, so skipping those folders is required         |

That stays under 300 ms. If a future step pushes past the budget, that step gets its own cache,
keyed on the resolved config, one per platform. The timing is measured again when B ships.

#### B4. `prebuild: false`

The CLI only does autolinking, as today.

What to do with plugins that need native changes:

| Option                                     | Cost   | Problem                                        |
| ------------------------------------------ | ------ | ---------------------------------------------- |
| a. Ignore the mods                         | none   | Push breaks silently                           |
| b. Error whenever a plugin has mods        | small  | Notifications becomes unusable in this mode    |
| **c. Check what's required (recommended)** | medium | `plutil` on macOS only, which iOS needs anyway |

With (c), the CLI generates in memory and checks that what the mods and the config **add** is present
in the app's own files: top-level Info.plist keys, entitlement keys, `<uses-permission>` names, and
extension targets (by name, in the pbxproj). If anything is missing, it fails and prints the snippet
to add. Fields that only prebuild uses (`name`, `icon`, `splash`, `version`, `signing`…) are an error
in this mode.

#### B5. Migration guide (`docs/migrating-to-prebuild.md`)

Written for eufit and any app made before prebuild:

1. Upgrade `@nativue/core` and commit, so git holds the current ios/ and android/.
2. Fill in `nativue.config.ts`: name, ids, version, icon, splash, Info.plist keys, permissions, URL
   schemes.
3. **Signing:**
   - iOS: copy the team id from Xcode (Signing & Capabilities) into `ios.appleTeamId`, or into an env
     variable when developers use different teams.
   - Android: move the keystore out of `android/` into `credentials/` (gitignored), fill in
     `android.signing`, and put the passwords in env variables, locally and as CI secrets.
4. Run `npx nativue prebuild --force`, then `git diff ios android`. Git shows exactly what the
   generated projects lose compared with the hand-made ones.
5. Move each remaining difference to its place (the B2 table): config, `android.gradle`, `resources`,
   a local plugin, `native/`, or an extension target. Repeat until the diff contains only expected
   changes.
6. Run `git rm -r --cached ios android`, add both folders to `.gitignore`, and commit.
7. Build and run on both platforms, plus a signed Android release build
   (`./gradlew bundleRelease`).

Alternative: keep the projects by hand with `prebuild: false`.

### C. Config plugins

```ts
export interface NativuePlugin {
  name: string
  vite?: VitePlugin | VitePlugin[]
  runtime?: string
  ios?: {
    infoPlist?: (plist: PlistDictionary, context: PrebuildContext) => void
    entitlements?: (entitlements: PlistDictionary, context: PrebuildContext) => void
    targets?: (targets: IosTarget[], context: PrebuildContext) => void // §J
  }
  android?: {
    manifest?: (manifest: XmlElement, context: PrebuildContext) => void
    strings?: (strings: Record<string, string>, context: PrebuildContext) => void
    gradle?: (gradle: AndroidGradle, context: PrebuildContext) => void // §L, structured
    gradleProperties?: (properties: Record<string, string>, context: PrebuildContext) => void
    settingsGradle?: (settings: AndroidSettingsGradle, context: PrebuildContext) => void
    // last resort: run after everything else, on the rendered text
    buildGradleContents?: (contents: string, context: PrebuildContext) => string
    settingsGradleContents?: (contents: string, context: PrebuildContext) => string
  }
}

interface PrebuildContext {
  config: NativueConfig
  projectRoot: string
  platform: 'ios' | 'android'
  addResource(source: string, destinations: ResourceDestinations): void // §K
}

/** Attribute names keep their prefix: 'android:name', 'tools:node'. */
interface XmlElement {
  tag: string
  attributes: Record<string, string>
  children: XmlElement[]
}
```

- **No parsers, no new dependency.** Core has small serializers for plist (XML), OpenStep plist
  (pbxproj) and XML. The base documents are built from the config and the template, never read back.
- **Manifest root:** it always declares `xmlns:android` and `xmlns:tools`.
- **Declaring a plugin:** in the package's `package.json`,
  `"nativue": { "plugin": "./plugin.mjs", "ios": {...}, "android": {...} }`. The file's default export
  is `(options?) => NativuePlugin`.
- **Applying plugins:** every autolinked package with a plugin is applied without options. Listing it
  in `plugins` with options replaces that default (they're matched by `name`).
- **Order:** base config → autolinked plugins (in `package.json` dependency order) → the config's
  `plugins`, in order → the config's own `ios.*` / `android.*` fields, last, so the app always wins.
  Within one prebuild, all structured mods run before the `*Contents` text mods.
- **On Android, a package's own entries live in its library manifest**, which Gradle merges. The
  `manifest` mod is for app-level changes and optional permissions (§F2).

### D. Lifecycle events

#### D1. iOS

The generated `App.swift`:

```swift
@main
struct MainApp: App {
    @UIApplicationDelegateAdaptor(NativueAppDelegate.self) private var appDelegate

    init() { NativueAppDelegate.plugins = nativuePlugins }   // before any delegate callback

    var body: some Scene {
        WindowGroup { NativueView(plugins: nativuePlugins) }
    }
}
```

```swift
// packages/core/ios/AppLifecycle.swift
public protocol AppLifecycleListener: AnyObject {
    func didFinishLaunching(options: [UIApplication.LaunchOptionsKey: Any]?)
    func didRegisterForRemoteNotifications(deviceToken: Data)
    func didFailToRegisterForRemoteNotifications(error: Error)
    func didReceiveRemoteNotification(_ userInfo: [AnyHashable: Any]) async -> UIBackgroundFetchResult
    /// Custom schemes and universal links. true: consumed.
    func open(url: URL) -> Bool
}

public protocol NotificationCenterListener: AnyObject {
    /// nil: no opinion.
    func willPresent(_ notification: UNNotification) async -> UNNotificationPresentationOptions?
    func didReceive(_ response: UNNotificationResponse) async
}
// Both have empty default implementations: a plugin implements only what it needs.
```

`NativueAppDelegate` forwards delegate callbacks to the plugins that conform.
`@UIApplicationDelegateAdaptor` is the SwiftUI way to receive them, on iOS 14+
([docs](https://developer.apple.com/documentation/swiftui/uiapplicationdelegateadaptor)).

**Rules:**

- **`open(url)`**
  - Order: native listeners first, in plugin order (dependency order, then `native/`). The first that
    returns `true` consumes the URL. If none does, the JS `onOpenURL` listeners run in registration
    order, first `true` consumes. If none of those does, the URL goes to the router.
  - Why native first: native SDKs (Google Sign-In, Facebook) must see the URL synchronously, even on a
    cold start before JS exists; JS listeners can't run until the runtime is up.
  - Cold start: the launch URL waits until the first render, then follows the same order, so JS
    listeners registered in `setup` see it too.
  - Universal links arrive through `.onOpenURL` as well
    ([docs](<https://developer.apple.com/documentation/swiftui/view/onopenurl(perform:)>)).
- **`didReceiveRemoteNotification`**
  - All listeners run concurrently, in a `TaskGroup`, and their results combine: `newData` if any
    returned `newData`; `failed` if any failed and none returned `newData`; `noData` otherwise.
  - The completion handler is called exactly once. iOS gives the app 30 seconds before it terminates
    it ([docs](<https://developer.apple.com/documentation/uikit/uiapplicationdelegate/application(_:didreceiveremotenotification:fetchcompletionhandler:)>)),
    so core stops waiting at 25 s and combines the listeners that finished.
- **Notification center delegate**
  - Core owns `UNUserNotificationCenter.current().delegate` and sets it in
    `application(_:willFinishLaunchingWithOptions:)`. Apple requires it to be set before launch
    finishes, or incoming notifications can be missed
    ([docs](https://developer.apple.com/documentation/usernotifications/unusernotificationcenterdelegate)).
  - **Packages must never set it themselves.**
  - `willPresent`: listeners run concurrently, and the presentation options are the union of the
    non-nil answers. If nobody has an opinion, the result is `[]` (not shown in the foreground).
  - `didReceive`: every listener runs.
  - Each completion handler is called once, after all listeners finish (or at the 25 s deadline).
    Apple requires both handlers to be called.
  - This is how notifications, a future Firebase package and others live together. A Firebase package
    must turn off swizzling (`FirebaseAppDelegateProxyEnabled` = boolean `NO`) and forward the token
    with `Messaging.messaging().apnsToken = deviceToken`
    ([docs](https://firebase.google.com/docs/cloud-messaging/ios/client)).
- **`app.state`**

  | Option          | iOS                                                                                                                                                                                   | Android                                                                                                                                                                                                                                                                                                                    |
  | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | **Recommended** | `UIApplication.didBecomeActiveNotification` / `didEnterBackgroundNotification`, observed by the Bridge, which already uses NotificationCenter and is independent of the view tree     | `ProcessLifecycleOwner` (`androidx.lifecycle:lifecycle-process`): `ON_RESUME` → `active`, `ON_STOP` → `background`. Correct even when a plugin opens its own activity. `ON_STOP` arrives "with a delay" after the last activity ([docs](https://developer.android.com/reference/androidx/lifecycle/ProcessLifecycleOwner)) |
  | Alternative     | SwiftUI `scenePhase` from `App` (`.active` if any scene is active, [docs](https://developer.apple.com/documentation/swiftui/scenephase)): the same states, but tied to the view layer | The activity's `onResume` / `onStop`: no dependency, but it says `background` while the app's own camera activity is in front                                                                                                                                                                                              |
  - **States:** only `active` and `background`, and only on transitions. **`inactive` stays out**:
    Apple describes it as temporary ("only pass through this phase temporarily"), and it fires for
    notification center pulls and system alerts. Android has no equivalent. Permission requests
    already refresh on their own.
  - JS: `AppState.current` and `addNativeListener('app.state', …)`. `inactive` can be added later if a
    package needs it.

#### D2. Android: Activity and plugin lifetime

The question is what happens when the Activity is recreated (an unhandled configuration change, or
the process dying while in the background).

| Option                                      | Behavior                                                                                                                      | Problem                                                                                                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a. Today: per-activity plugins              | Every `onCreate` builds a new Bridge, registry and plugin instances                                                           | Services that run without an activity (a `FirebaseMessagingService` receiving a token) can't find the plugin; different from iOS, where instances live for the whole process |
| **b. Process-scoped plugins (recommended)** | One `PluginRegistry` per process with `applicationContext`; `register()` runs once; each new activity is announced to plugins | A small API change: `registry.context` becomes the application context (haptics uses it as an Activity; migrated in step 8.1)                                                |

With (b):

```kotlin
interface ActivityListener {
    /** In onCreate, on every creation: register activity-result launchers here, unconditionally, in the same order. */
    fun onActivityCreated(activity: ComponentActivity) {}
    /** Drop anything holding the activity. */
    fun onActivityDestroyed() {}
}

class PluginRegistry {
    val context: Context                          // application context
    val activity: ComponentActivity?              // current, read through a getter; null between activities
    fun requireActivity(): ComponentActivity      // throws, and the call rejects with ERR_UNAVAILABLE
    fun sendEvent(name: String, payload: Any?)    // dropped when no JS runtime

    companion object {
        @Volatile private var instance: PluginRegistry? = null

        /** From any component (activity, service, receiver); the first call creates it, once, thread-safe. */
        fun get(context: Context): PluginRegistry =
            instance ?: synchronized(this) {
                instance ?: PluginRegistry(context.applicationContext).also { instance = it }
            }
    }
}
```

- **No stale activity:** the registry holds the current activity in a field it clears in
  `onDestroy`. Plugins read it through the getter and never store it. Lint rule in the docs: "don't
  keep `activity` in a field".
- **Registering launchers:** in `onActivityCreated`, on every creation, unconditionally and in the
  same order. Google requires exactly that for in-flight results to reach the right callback
  ([docs](https://developer.android.com/training/basics/intents/result)).
- **`NativueActivity`** extends `ComponentActivity` (`androidx.activity` ≥ 1.7, for the photo
  picker's fallback). Plugins read new intents with `addOnNewIntentListener` (androidx.activity 1.5+).
- **The JS runtime still lives with the Activity**, as today. A recreation restarts JS, which is what
  `getPendingResult()` covers.

**Registry at process start.** A push can start the process with no activity: `FirebaseMessagingService`
runs and calls `onNewToken`. If nothing has created the registry yet, `PluginRegistry.shared` is null
and the token is lost.

| Option                                                                 | How                                                                                                                                                                                                                                                                                                                            | Trade-off                                                                                                                              |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| **a. Created on first use, from any component (recommended)**          | `PluginRegistry.get(context)` builds the registry from `context.applicationContext` the first time anything asks: the activity, a service or a receiver. The service calls `PluginRegistry.get(this)` and hands the token to the plugin, which stores it (`SharedPreferences`) and sends it as an event when a runtime exists. | No new dependency and no startup cost for apps that never use it. Works with `prebuild: false`, since nothing changes in the app.      |
| b. `androidx.startup` initializer in core's library manifest           | Merged into every app; creates the registry on every process start                                                                                                                                                                                                                                                             | Adds `androidx.startup:startup-runtime`, and pays the plugin `register()` cost even for a process started only to run a background job |
| c. A generated `Application` class (`android:name=".MainApplication"`) | Created in `Application.onCreate`                                                                                                                                                                                                                                                                                              | Only for generated projects; `prebuild: false` apps have to add it by hand                                                             |

- (a) covers the push case and costs nothing up front. If a plugin later needs to run on **every**
  process start (none of the planned ones do), (b) can be added on top without changing plugin code.
- `register()` must therefore never assume an activity exists. Activity work goes in
  `onActivityCreated` (above).
- iOS is already equivalent: `nativuePlugins` is a global, created on first access, and
  `NativueAppDelegate` touches it in `willFinishLaunching`.

**`configChanges`: what recreates the activity.** The generated `AndroidManifest.xml` keeps the
template's `android:configChanges` on the main activity:
`orientation|screenSize|smallestScreenSize|screenLayout|keyboard|keyboardHidden|uiMode|fontScale|locale|layoutDirection`.
`density` is added, so changing the display size doesn't recreate it either.

- With that list, **rotating the phone, dark mode, font size, language, display size, split screen
  and a hardware keyboard** don't recreate the activity: `NativueActivity.onConfigurationChanged` tells
  the Bridge and JS keeps running.
- What still recreates it: process death, plus the rare changes left out (`mcc`/`mnc` when a SIM is
  swapped, `touchscreen`, `navigation`, `colorMode`). §D2 and `getPendingResult()` cover those.
- The list is generated, not editable. A test asserts it, so a template change can't drop an entry
  without someone noticing.

**`getPendingResult()` convention.** Google: when the camera is used, it is "almost certain" the
process will be destroyed ([docs](https://developer.android.com/training/basics/intents/result)).

1. Before launching, the plugin saves what it needs to read the result (options, the output file
   path) in `SharedPreferences` under `<package>.pending`.
2. The launcher's callback checks for a Promise waiting in the current runtime. If there is one, it
   resolves it and clears the record. If there isn't (a new process or a new runtime), it stores the
   result as pending.
3. JS calls `ImagePicker.getPendingResult(): Promise<Result | null>`, which returns the pending result
   once and clears it. The package README tells apps to call it at startup.
4. On iOS it always returns `null`, since the picker dies with the app.

### E. Native → JS module events

```swift
registry.sendEvent("notifications.received", payload)   // iOS and Android, any thread
```

```ts
import { addNativeListener, onOpenURL } from '@nativue/core'
const subscription = addNativeListener('notifications.received', (payload) => {})
subscription.remove()
onOpenURL((url) => (url.startsWith('myapp://oauth') ? (finishLogin(url), true) : false))
```

An event sent while there is no JS runtime is dropped. State that must survive is read with a
function instead (`getLastNotificationResponse()`, `getPendingResult()`).

### F. Permissions

#### F1. Model

```ts
export interface PermissionResponse {
  status: 'granted' | 'denied' | 'undetermined'
  granted: boolean
  canAskAgain: boolean
}
export type PermissionResponseWith<Extra extends object> = PermissionResponse & Extra

export function usePermission<Response extends PermissionResponse, Options>(
  get: () => Promise<Response>,
  request: (options?: Options) => Promise<Response>,
): { permission: Ref<Response | null>; request: (options?: Options) => Promise<Response> }

/** The app's page in system Settings: the way out when canAskAgain is false. */
export function openSettings(): Promise<void>
```

**`openSettings()`:**

- iOS: `UIApplication.openSettingsURLString`, iOS 8+
  ([docs](https://developer.apple.com/documentation/uikit/uiapplication/opensettingsurlstring)).
- Android: `Settings.ACTION_APPLICATION_DETAILS_SETTINGS` with `package:<id>`. Google warns that a
  matching activity "may not exist", so that case rejects with `ERR_UNAVAILABLE`
  ([docs](https://developer.android.com/reference/android/provider/Settings)).
- The notifications package adds `openNotificationSettings()`:
  - iOS 16+: `openNotificationSettingsURLString`; earlier versions open the app's settings;
  - Android 8+: `ACTION_APP_NOTIFICATION_SETTINGS` with `EXTRA_APP_PACKAGE`.

**Where the extra fields go:**

| Option                                          | Example                       | Trade-off                                                                                                            |
| ----------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Flat, named after the concept (recommended)** | `accessPrivileges: 'limited'` | Code branches on capability. A field that exists on one platform only is optional, absent on the other, never faked. |
| Grouped by platform                             | `ios: { status }`             | The same concept ends up in two places                                                                               |

**Rules:**

- `granted` is true when the feature works at all, even partly; partial states are spelled out in
  the extra fields.
- `undetermined` only when the user was never asked. `canAskAgain: false` → only Settings can change
  it, through `openSettings()`.
- Each README has a table mapping native states to these fields.
- `usePermission` re-reads the status on mount, after `request`, and when `app.state` becomes
  `active`.

**The planned extra fields:**

| Package              | Extra field                                                              | iOS                                                                                                                                                                                                                                                  | Android                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| notifications        | `provisional?`, `ephemeral?` (iOS only)                                  | `.provisional` iOS 12+, `.ephemeral` iOS 14+ ([1](https://developer.apple.com/documentation/usernotifications/unauthorizationoptions/provisional), [2](https://developer.apple.com/documentation/usernotifications/unauthorizationstatus/ephemeral)) | `POST_NOTIFICATIONS` at runtime on Android 13+ ([3](https://developer.android.com/develop/ui/views/notifications/notification-permission)) |
| image-picker / media | `accessPrivileges: 'all' \| 'limited' \| 'none'`                         | `.limited` iOS 14+ ([4](https://developer.apple.com/documentation/photos/phauthorizationstatus/limited))                                                                                                                                             | `READ_MEDIA_VISUAL_USER_SELECTED`, Android 14+ ([5](https://developer.android.com/about/versions/14/changes/partial-photo-video-access))   |
| location             | `accuracy: 'precise' \| 'approximate'`, `scope: 'whenInUse' \| 'always'` | `accuracyAuthorization` iOS 14+ ([6](https://developer.apple.com/documentation/corelocation/cllocationmanager/accuracyauthorization))                                                                                                                | fine/coarse; `ACCESS_BACKGROUND_LOCATION`                                                                                                  |

**Native helpers in core:**

- iOS: `PermissionResponse.dictionary(status:canAskAgain:extra:)`.
- Android: `Permissions.get` / `Permissions.request`, on `RequestMultiplePermissions`. The launcher is
  registered in `onActivityCreated` (§D2).
- Android can't tell "never asked" from "denied forever", so a SharedPreferences "asked" flag plus
  `shouldShowRequestPermissionRationale` provide `undetermined` and `canAskAgain`.
- On Android 12L and lower, a notifications "Don't allow" isn't asked again until a reinstall
  ([3](https://developer.android.com/develop/ui/views/notifications/notification-permission)). That
  surfaces as `canAskAgain: false`.

#### F2. Android permissions

- **The package manifest holds only what the package always uses.**
- **Optional or Play-sensitive permissions come from plugin options**, added with the `manifest` mod:

| Permission                               | Why it's opt-in                                                                                                                                                                                                                                                                                                                                                                                                                               | Option                                   |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `SCHEDULE_EXACT_ALARM`                   | Denied by default on Android 14 for most new installs targeting 13+ ([7](https://developer.android.com/about/versions/14/changes/schedule-exact-alarms)). `USE_EXACT_ALARM` can't be published outside alarm/clock/calendar apps, so nativue never adds it.                                                                                                                                                                                   | `notifications({ exactAlarms: true })`   |
| `ACCESS_BACKGROUND_LOCATION`             | Play requires a declaration form, a video and a prominent disclosure ([8](https://support.google.com/googleplay/android-developer/answer/9799150))                                                                                                                                                                                                                                                                                            | `location({ background: true })`         |
| `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO` | Allowed only when broad access is core to the app, enforced since 2025-05-28 ([9](https://support.google.com/googleplay/android-developer/answer/13986130), [10](https://support.google.com/googleplay/android-developer/answer/14115180)). The default is the photo picker: no permission, API 19+ through a backport, falling back to `ACTION_OPEN_DOCUMENT` ([11](https://developer.android.com/training/data-storage/shared/photopicker)) | `imagePicker({ fullMediaAccess: true })` |
| `CAMERA` in image-picker                 | `ACTION_IMAGE_CAPTURE` needs no permission, but if the merged manifest declares `CAMERA` without it being granted, the intent throws a `SecurityException` ([12](https://developer.android.com/reference/android/provider/MediaStore#ACTION_IMAGE_CAPTURE)). image-picker never declares it, and requests it at runtime only when the merged manifest has it.                                                                                 | —                                        |

- **Blocking:** `android.blockedPermissions` writes `<uses-permission … tools:node="remove"/>`
  ([13](https://developer.android.com/build/manage-manifests)).
- **README:** each package has a "Permissions" table (permission, platform, when it's added, which
  option adds it).

### G. Module conventions (written into docs/packages.md and AGENTS.md)

- **Names:** `package.function`. Async for anything that waits; sync only for cheap reads.
- **Errors:** iOS throws `PluginError(code: "ERR_…", message:)`; Android calls
  `promise.reject(code, message)`. JS gets an `Error` with `.code`. Common codes:
  `ERR_PERMISSION_DENIED`, `ERR_UNAVAILABLE`, `ERR_CANCELED`, `ERR_INVALID_ARGUMENT`.
- **Threads:** unchanged.
- **Hot reload:** JS listeners die with the runtime, and composables remove theirs on unmount. Plugin
  instances live for the whole process on both platforms (§D2).
- **Activity-bound results:** follow §D2. Never store `activity`; anything that opens another
  activity has a `getPendingResult()`.

### H. Tests, CI, scaffolding

- **Prebuild tests (node, no Xcode):** snapshots of:
  - Info.plist, entitlements, manifest and strings;
  - **the pbxproj with and without an extension target**;
  - **`build.gradle.kts` / `settings.gradle.kts` with the markers filled in**, plus a text mod
    applied after them.

  Plus the idempotency test, every B2 case, and `addResource` name validation.

- **`@nativue/core/testing`:** `mockNativeFunction(name, impl)` and `emitNativeEvent(name, payload)`.
- **GitHub Actions:** from a clean checkout:
  - `npm test` and typecheck on ubuntu;
  - `assembleDebug` on ubuntu;
  - `xcodebuild` for the simulator on macos.

  Once 8.4 lands, the iOS build includes the Notification Service Extension.

- **Scaffolding, last:** `npm create nativue -- --module <name>`.

### I. Signing

**iOS.**

- `ios.appleTeamId` → `DEVELOPMENT_TEAM` in the generated pbxproj, for the app and every extension
  target. Since it's TS, it can come from `process.env`.
- When it's missing, `nativue run` keeps today's detection (exactly one certificate → its team).
  Otherwise it fails and the error asks for `ios.appleTeamId`, instead of "pick it in Xcode".
- Signing stays Automatic, with `-allowProvisioningUpdates`. The B2 message for a pbxproj edit that
  touches `DEVELOPMENT_TEAM` proposes this field.

**Android.**

| Option                                                                                              | Where the secrets end up                                                   | Notes                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| a. Values in the config (read from env when the config loads), written into `build.gradle.kts`      | In plain text in the generated `android/`, and in any cache of that folder | Google: "your signing information is included in plain text in your Gradle build files… keep your signing information secure by removing it from the build files" ([docs](https://developer.android.com/studio/publish/app-signing)) |
| **b. The config names env variables; the generated Gradle reads them when it builds (recommended)** | Nowhere on disk                                                            | `storePasswordEnv: 'ANDROID_STORE_PASSWORD'` → `System.getenv("ANDROID_STORE_PASSWORD")`. Natural for CI secrets.                                                                                                                    |
| c. A `keystore.properties` outside `android/`, referenced by the config                             | In that file, gitignored                                                   | Google's documented pattern; CI has to write the file from secrets                                                                                                                                                                   |

- (b) is recommended because the passwords never touch a file nativue writes. Google's page doesn't
  mention env variables, but it's (a) that it warns against; both (b) and (c) follow its advice.
- `storeFile` is relative to the app (`./credentials/upload.keystore`), outside `android/`.
  `credentials/` is in the template's gitignore.
- The `release` signing config is set only when the environment variables are present, so debug
  builds never need them. `bundleRelease` without them fails with a message naming the missing
  variables.
- **Outside the terminal.** Android Studio started from the Dock doesn't get the shell's environment
  variables, so `System.getenv` alone fails there. Each password name in the config is therefore
  looked up in two places:

  ```kotlin
  // generated
  fun secret(name: String) = providers.gradleProperty(name).orElse(providers.environmentVariable(name)).orNull
  storePassword = secret("ANDROID_STORE_PASSWORD")
  ```

  1. A **Gradle property**, which Gradle reads from `~/.gradle/gradle.properties` in the user's home.
     That file is outside the repo and outside `android/`, so nothing nativue generates holds the
     secret. This is how Android Studio and local release builds get it.
  2. Otherwise an **environment variable**: CI, or a terminal with it exported.

- **CI.** The keystore is binary, so it goes into a secret as base64. A workflow step decodes it to
  `credentials/upload.keystore` before the build; the passwords come from secrets as environment
  variables:

  ```yaml
  - run: echo "$ANDROID_KEYSTORE_BASE64" | base64 --decode > credentials/upload.keystore
    env: { ANDROID_KEYSTORE_BASE64: '${{ secrets.ANDROID_KEYSTORE_BASE64 }}' }
  - run: npx nativue prebuild android && cd android && ./gradlew bundleRelease
    env:
      ANDROID_STORE_PASSWORD: ${{ secrets.ANDROID_STORE_PASSWORD }}
      ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
  ```

  The migration guide shows both: the lines for `~/.gradle/gradle.properties`, and the command to
  create the secret (`base64 -i credentials/upload.keystore | pbcopy`).

- The keystore is the **upload key**: Play App Signing signs the final build
  ([docs](https://developer.android.com/studio/publish/app-signing)).

### J. iOS extension targets (Notification Service, widgets, share)

| Option                                                          | Cost                                                                                           | Problem                                                                            |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **a. Generate `project.pbxproj` from a JS model (recommended)** | ~200 lines: a model → OpenStep plist serializer, ids derived from a hash of each object's path | No external tool; idempotent like everything else                                  |
| b. pbxproj parser + mods                                        | A parser, or an unmaintained npm package                                                       | Breaks the "no parser" rule and depends on edits to a file that's generated anyway |
| c. XcodeGen / Tuist                                             | An extra binary to install (Homebrew or Mint), in CI too                                       | Another tool and YAML/Swift config next to `nativue.config.ts`                     |

(a) is easy here: the template's pbxproj is already 250 lines with fixed ids and **buildable
folders**, which "only record the folder path into the project file without enumerating the contained
files" ([Xcode 16 notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-16-release-notes)).
So the model lists folders, not files. That requires Xcode 16, which costs nothing: App Store uploads
have required Xcode 26 since 2026-04-28 ([upcoming requirements](https://developer.apple.com/news/upcoming-requirements/)).
Apple doesn't document the pbxproj format itself (`PBXFileSystemSynchronizedRootGroup`,
`objectVersion`), so the snapshot tests and the CI `xcodebuild` are what protect it.

```ts
interface IosTarget {
  name: string // 'NotificationService'
  type: 'notification-service' | 'notification-content' | 'widget' | 'share'
  sources: string // a folder: in the package, or native/extensions/<name>
  bundleIdSuffix: string // '.NotificationService' → com.company.myapp.NotificationService
  deploymentTarget?: string // defaults to the app's (15.1)
  infoPlist?: PlistDictionary // merged over the base NSExtension dict for the type
  entitlements?: PlistDictionary
  appGroups?: boolean // gets config.ios.appGroups
  swiftPackages?: SwiftPackageDependency[] // same shape as nativue.ios.dependencies
  buildSettings?: Record<string, string>
}
```

- **Type → product type and extension point:** `com.apple.product-type.app-extension`, with
  `NSExtensionPointIdentifier`:
  - `notification-service`: `com.apple.usernotifications.service`
    ([docs](https://developer.apple.com/documentation/usernotifications/unnotificationserviceextension));
  - `widget`: `com.apple.widgetkit-extension`;
  - `share`: `com.apple.share-services`.
- **Generated per target:**
  - a buildable folder, `ios/Extensions/<name>`, symlinked to `sources` the way
    `ios/NativuePlugins/Sources` already is;
  - `ios/ExtensionSupport/<name>/Info.plist` and `.entitlements`, kept outside that folder so they
    aren't copied as resources;
  - Debug/Release build configurations: `PRODUCT_BUNDLE_IDENTIFIER`, `DEVELOPMENT_TEAM`,
    `INFOPLIST_FILE`, `CODE_SIGN_ENTITLEMENTS`, deployment target, and `buildSettings`;
  - SwiftPM product dependencies;
  - a target dependency, plus the app's **"Embed Foundation Extensions"** copy-files phase (into
    `PlugIns`).
- **App Groups:** `ios.appGroups` goes into the app's
  `com.apple.security.application-groups` entitlement
  ([docs](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.application-groups))
  and into every target with `appGroups: true`.
- **Declaring targets:**
  - packages: the `ios.targets` mod, so they can depend on options (`notifications({ richMedia: true })`);
  - apps: `native/extensions/<name>/` with
    `nativue.json → { "ios": { "target": { "type": "widget", "bundleIdSuffix": ".Widget" } } }`. The
    autolinker skips `native/extensions` when looking for plugin modules.
- **Extensions don't link `Nativue`** (no Hermes): they are plain Swift with their own SwiftPM
  dependencies.

**Unproven: does Xcode follow a symlinked buildable folder?** `ios/NativuePlugins/Sources` works
through symlinks because **SwiftPM** follows them. Whether an Xcode **buildable folder** does is not
documented. So step 3c starts with a spike that compares three ways of pointing a target at the
package's sources:

1. a buildable folder at `ios/Extensions/<name>`, a symlink to the package's folder;
2. a buildable folder whose `path` points outside the project (`../node_modules/<package>/<folder>`);
3. a **copy** of the sources into `ios/Extensions/<name>`, as generated files, hashed and protected
   like the rest (B2).

**What each one must pass:**

- a clean build and an incremental one after a source edit;
- the files appear in Xcode's navigator, and breakpoints work;
- `xcodebuild` in CI;
- an archive (`xcodebuild archive`) that contains the extension.

The first that passes everything is used, in that order of preference. (3) always works, with one
cost: editing a package's extension sources needs a prebuild. The spike's result is recorded in this
RFC, and a CI build of the demo extension keeps checking it.

**Spike result (2026-11-26, Xcode 26):** (1), the symlink, is used. On a Notification Service
Extension from a package in `node_modules`, (1) and (2) both passed a clean simulator build, an
incremental build that picked up an edit to the package's Swift file, and `xcodebuild archive` with
the `.appex` in `PlugIns` and the edited code in its Release binary. (3) passed everything but the
incremental build, as expected. The navigator and breakpoints were not checked from the terminal.
In Debug, Xcode puts an extension's code in `<name>.debug.dylib` next to its executable.

**Android widgets:** nothing beyond the merger. The `<receiver>` with `APPWIDGET_UPDATE`, the
`android.appwidget.provider` meta-data, and the `AppWidgetProviderInfo` XML with its layout are all
manifest and resources
([docs](https://developer.android.com/develop/ui/compose/glance/create-app-widget)). Library manifests
and resources merge into the app
([1](https://developer.android.com/build/manage-manifests),
[2](https://developer.android.com/studio/projects/android-library)).
One gap for **app-local** code: `native/<name>/android` is compiled straight into the app, so it can't
ship a manifest or `res/`. Fix: a `native/<name>/android` folder with an `AndroidManifest.xml` or
`res/` becomes a library module (with a generated `build.gradle.kts`, Maven dependencies from its
`nativue.json`), exactly like a package.

### K. Resources

```ts
context.addResource('./sounds/chime.wav', {
  ios: { destination: 'chime.wav' }, // default: the file name at the bundle root
  android: { type: 'raw', name: 'chime' }, // 'raw' | 'assets' | 'font' | 'drawable'
  font: false, // true: iOS UIAppFonts entry + Android res/font
})
// either platform can be `false`; the app's own config has `resources: [...]` with the same shape
```

- **iOS:** the file is copied to `ios/App/Resources/`, inside the app's buildable folder, so it lands
  in the bundle with no pbxproj change.
  - Requires Xcode 16, already the floor (§J).
  - Notification sounds go in the main bundle, as aiff, wav or caf, under 30 s
    ([docs](https://developer.apple.com/documentation/usernotifications/unnotificationsound)).
- **Android:** `res/raw/<name>`, `res/font/<name>` or `res/drawable/<name>`, or `assets/<path>`.
  - Resource names are validated (`^[a-z][a-z0-9_]*$`, without the extension), and the error suggests
    a valid name. Google states this rule officially only for image assets ("lowercase characters,
    underscores, and digits only",
    [docs](https://developer.android.com/studio/write/image-asset-studio)); aapt2 enforces it for every
    `res/` file. `assets/` keeps its path and isn't validated.
- Resources are generated files: they're hashed and protected like any other (B2).

### L. Gradle

Marker comments in the template, filled in from a structured model:

```kotlin
// app/build.gradle.kts (template)
plugins {
    id("com.android.application")
    // @nativue:plugins
}
android {
    // ...namespace, defaultConfig, signing (§I)
    // @nativue:android          → manifestPlaceholders, buildConfigField, buildFeatures.buildConfig
}
dependencies {
    implementation(project(":nativue"))
    // @nativue:dependencies
}
```

```ts
interface AndroidGradle {
  plugins: { id: string; version?: string }[] // a version goes into settings pluginManagement
  dependencies: {
    configuration: 'implementation' | 'api' | 'compileOnly' | 'runtimeOnly'
    notation: string
  }[]
  manifestPlaceholders: Record<string, string>
  buildConfigFields: { type: 'String' | 'boolean' | 'int' | 'long'; name: string; value: string }[]
}
interface AndroidSettingsGradle {
  repositories: string[] // Maven URLs, added to pluginManagement and dependencyResolutionManagement
}
// gradle.properties: Record<string, string>
```

- **`buildConfigFields`** also turns on `buildFeatures { buildConfig = true }`, since AGP 8 generates
  no `BuildConfig` by default
  ([AGP 8.0 notes](https://developer.android.com/build/releases/past-releases/agp-8-0-0-release-notes)).
- **Settings file:** `settings.gradle.kts` gets `// @nativue:plugin-management` and
  `// @nativue:repositories`.
- **Same data for both:** the app's `android.gradle` and the plugins' `android.gradle` mod fill the
  same structure. The `*Contents` text mods run after the markers are filled in, as a last resort.
- **A package's own dependencies** stay in its own `android/build.gradle.kts`. `android.gradle` is for
  app-level changes only.

### M. Notifications on Android without the google-services Gradle plugin

The plugin only turns `google-services.json` into string resources, which `FirebaseInitProvider`
reads before app code runs
([1](https://firebase.google.com/docs/android/google-services-plugin-and-file),
[2](https://firebase.google.com/docs/projects/multiprojects)). The notifications plugin writes them
with the `strings` mod. Firebase and FCM need API 24+ and the Play Store on the device
([3](https://firebase.google.com/docs/android/setup),
[4](https://firebase.google.com/docs/cloud-messaging/android/client)), the same minSdk as nativue.

**Custom sounds on Android:**

- A channel's sound is fixed once the channel is created
  ([docs](https://developer.android.com/develop/ui/views/notifications/channels)), so each sound gets
  its own channel.
- `NotificationChannel.setSound` warns against `android.resource` URIs "as resource ids can change on
  app upgrade". 8.4 decides between a name-based `android.resource://<package>/raw/<name>` URI and
  copying the file to app storage behind a `content://` URI, and records the choice in the README.

### Publishing

- **Process:** unchanged.
- **peerDependency:** migrated and new packages peer-depend on `@nativue/core: ">=0.14.0"`.
- **Minimums:**
  - iOS 15.1. Apple's next floor, from April 2027, is "target iOS 15 or later" with the iOS 27 SDK
    ([docs](https://developer.apple.com/ios/submit/)), so 15.1 still passes.
  - Android minSdk 24.
  - Xcode 16 to open projects (buildable folders); Xcode 26 to upload.
- **Docs per package:** a README with install, plugin options, a permissions table, the permission
  state mapping, `getPendingResult` when it has one, and the API. Plus a row in `docs/packages.md`
  and a line in `packages/core/AGENTS.md`.

## Implementation order

1. This RFC, as `docs/rfcs/packages-foundation.md`.
2. **Prebuild**, in two PRs:
   - **2a. The engine** (B1–B3, the J generator without targets). Behavior doesn't change: the
     generated projects equal today's template.
     - Move the template into core; add `fillPlaceholders` and `__CORE_PATH__`.
     - Write the plist / OpenStep / XML serializers, and **generate the pbxproj from a JS model that
       reproduces today's file byte for byte**.
     - Add the record, the B2 checks and `--force`.
     - Switch the demo and create-nativue to generated projects, and add the gitignore.
     - Rewrite the rules.
     - Add the snapshot, idempotency and protection tests, and measure the time.
   - **2b. App config** (A, B4, B5, I):
     - name, ids, version, icon, splash, `infoPlist` / `entitlements` / `permissions`;
     - `prebuild: false` with the check (c);
     - `ios.appleTeamId`;
     - `android.signing` with the Gradle property and environment variable lookup;
     - `docs/migrating-to-prebuild.md`, then tried on eufit.
3. **Config plugins**, in three PRs:
   - **3a. Mods** (C):
     - the mod API, discovering `nativue.plugin`, ordering, replacing a default plugin by `name`;
     - `blockedPermissions`, namespaced XML, `strings`;
     - snapshot tests of each mod.
   - **3b. Resources and Gradle** (K, L):
     - `addResource` / `resources` with name validation;
     - structured Gradle with the markers, then the `*Contents` text mods;
     - app-local Android library modules (`native/<name>/android` with a manifest or `res/`);
     - snapshots of the filled markers.
   - **3c. iOS extension targets** (J):
     - **first, the symlink spike**, with its result recorded in the RFC;
     - then the `ios.targets` mod, `native/extensions`, `ios.appGroups` and the embed phase;
     - a snapshot of the pbxproj with an extension target, and the CI `xcodebuild` building a demo
       extension.
4. **Module events and errors** (E, G): `registry.sendEvent`, `addNativeListener`, `onOpenURL`,
   `app.state`, error codes.
5. **Lifecycle** (D1, D2):
   - iOS: `NativueAppDelegate` with `AppLifecycleListener` and `NotificationCenterListener`, with the
     merge rules and the 25 s deadline;
   - Android: `ComponentActivity`, the process-scoped registry, `ActivityListener`, and the
     `getPendingResult` helpers.
6. **Permissions** (F): types, `usePermission`, `openSettings()`, native helpers.
7. **Testing and CI** (H).
8. **Validation, in four PRs:**
   1. **Migrate haptics and sqlite.** Haptics moves from `registry.context as Activity` to
      `requireActivity()`. Bump their peer dependency, update their docs.
   2. **`@nativue/notifications`, local only:**
      - permission (with `provisional`) and `openNotificationSettings()`;
      - scheduling;
      - showing while the app is open, through the core delegate;
      - a tap reaching JS;
      - `getLastNotificationResponse()`;
      - Android channels, `POST_NOTIFICATIONS`, `exactAlarms`.
   3. **Remote push:** the APNs token, FCM through strings.xml, remote notifications in the
      background (`UIBackgroundModes`), `aps-environment`.
   4. **Images and custom sounds:**
      - images in push through a Notification Service Extension (validates J and App Groups);
      - a custom sound (validates K, plus the Android channel sound decision).
9. **Scaffolding** (`--module`).

Each step is its own PR (Conventional Commits, no attribution trailer). After steps 2, 3, 5 and every
part of 8, a generated app is checked end to end: `npm pack` core, create an app in the scratchpad,
`npm run build`, `npm run typecheck`, iOS and Android builds. After step 2, the migration guide is
also tried on eufit.

## Verification

- **Tests:** `npm test` (core, tailwind, sqlite, prebuild snapshots) and `npm run typecheck`.
- **Idempotency:** `nativue prebuild` twice on the demo changes no file the second time.
- **Edit protection:**
  - edit `ios/Info.plist` by hand: `npm run dev` fails with the diff and the `ios.infoPlist` snippet,
    and `--force` restores the file;
  - pick a team in Xcode: the error proposes `ios.appleTeamId`.
- **Android release build:** `./gradlew bundleRelease` with the env variables set produces a signed
  bundle; without them, it fails naming the missing variables.
- **Demo, iOS simulator and Android emulator:**
  - haptics, sqlite and clipboard unchanged;
  - notifications, local: permission, a notification shown in the foreground, a tap reaching JS,
    `getLastNotificationResponse` after a cold start from a tap;
  - on Android, with "Don't keep activities" turned on: plugins get `onActivityCreated` again with
    the new activity, and nothing keeps the old one (checked with the Android Studio profiler). The
    full `getPendingResult()` flow is validated by image-picker, the first package to use it.
- **Remote push (8.3/8.4):** on a real iPhone (APNs key) and an Android device (Firebase project),
  including an image through the extension and a custom sound.
  - 8.3 also: with the app closed (swiped away from recents), a push still arrives; and the token
    received while closed is stored and delivered to JS when the app opens.
- **CI:** green on a PR from a clean checkout, with the extension target built.
