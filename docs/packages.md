# Packages

| Package                                                 | What it adds                                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [`@nativue/icons`](../packages/icons/README.md)         | 2,000+ Lucide icons as components, drawn natively; also tab and header icons |
| [`@nativue/tailwind`](../packages/tailwind/README.md)   | Tailwind CSS classes, turned into native styles when the app is built        |
| [`@nativue/clipboard`](../packages/clipboard/README.md) | copying text to the clipboard                                                |
| [`@nativue/haptics`](../packages/haptics/README.md)     | haptic feedback                                                              |
| [`@nativue/sqlite`](../packages/sqlite/README.md)       | SQLite databases                                                             |

Any npm package written in plain JavaScript or Vue works too, as long as it doesn't use the browser's
DOM.

## Plugins

Some packages change how the app is built, like `@nativue/tailwind`. They go in
`nativue.config.ts`, next to `package.json`:

```ts
import { defineConfig } from '@nativue/core/config'
import tailwind from '@nativue/tailwind'

export default defineConfig({
  plugins: [tailwind()],
})
```

A plugin is an object with a `name`, Vite plugins for the build (`vite`), a module the app
imports before it starts (`runtime`), and mods of the native files (`ios`, `android`, below).

## Writing a package with native code

[`@nativue/haptics`](../packages/haptics) is a small example of one. A package's `package.json` says where its native code is:

```json
"nativue": {
  "ios": { "sources": "ios", "plugin": "HapticsPlugin" },
  "android": { "sources": "android", "plugin": "dev.nativue.haptics.HapticsPlugin" }
}
```

Apps find it among their dependencies, with nothing to configure:

- **iOS:** `nativue prebuild` (also run by `dev`, `build` and `run`) writes `ios/NativuePlugins`, a Swift package with
  a target per package, made of its `sources` folder, and the list of plugins `App.swift` passes to
  `NativueView`. The target's module is named after the package (`@nativue/haptics` →
  `NativueHaptics`).
- **Android:** the app's `settings.gradle.kts` applies `nativue.settings.gradle.kts`, which adds
  the `sources` folder (a library whose `build.gradle.kts` depends on `project(":nativue")`) to the
  app, and the plugin class to the ones nativue creates.

`plugin` is a public class with a public, argument-less constructor. It registers functions and
views (`NativuePlugin`, `PluginRegistry`, `PluginView` in `@nativue/core`'s `ios/Plugins.swift` and
`android/.../Plugins.kt`):

```swift
public final class CameraPlugin: NativuePlugin {
    public init() {}

    public func register(in registry: PluginRegistry) {
        // Runs on the JavaScript thread, synchronously: hop to the main thread for UIKit.
        registry.addFunction("camera.isAvailable") { _ in
            UIImagePickerController.isSourceTypeAvailable(.camera)
        }

        // JavaScript gets a Promise: the result resolves it, a thrown error rejects it.
        registry.addAsyncFunction("camera.requestAccess") { _ in
            await AVCaptureDevice.requestAccess(for: .video)
        }

        // <CameraView> in JS; sendEvent("capture", payload) reaches @capture.
        registry.addView("CameraView") { sendEvent in CameraView(sendEvent: sendEvent) }
    }
}
```

On Android, async functions settle a `Promise` instead, from any thread:
`registry.addAsyncFunction("camera.requestAccess") { arguments, promise -> promise.resolve(true) }`.

Arguments and results are booleans, numbers, strings, `null`, arrays and objects of those, and
bytes: an `ArrayBuffer` or a typed array (`Uint8Array`...) arrives as `Data` on iOS and `ByteArray`
on Android, and returned bytes reach JavaScript as a `Uint8Array`, with no base64 in between.

Plugin views get their props through `PluginView.setProp(key, value)`; nativue applies `style`
and lays them out, sized by their style (they don't measure their content). The package's
JavaScript calls the functions with `requireNativeFunction` and renders the views by their tag:

```ts
import { defineComponent, h, requireNativeFunction } from 'vue'

export const isAvailable = requireNativeFunction<() => boolean>('camera.isAvailable')
export const requestAccess = requireNativeFunction<() => Promise<boolean>>('camera.requestAccess')
export const CameraView = defineComponent(
  (props, { attrs }) =>
    () =>
      h('CameraView', attrs),
)
```

### Events and errors

A plugin tells JavaScript about something it didn't ask for (a notification arrived, a download
finished) with `registry.sendEvent`, from any thread. Name events `package.event`:

```swift
registry.sendEvent("camera.captured", ["uri": fileURL.absoluteString])
```

```ts
import { addNativeListener } from 'vue'

const subscription = addNativeListener<{ uri: string }>('camera.captured', ({ uri }) => show(uri))
subscription.remove() // also removed when the component that added it unmounts
```

Events sent while no JavaScript runs (the app closed, a reload) are lost: keep what must outlive it
natively and let JavaScript read it with a function. The app's own `app.state` event says when it
goes `'active'` or `'background'`; `AppState.current` reads it.

An async function rejects with a code JavaScript can branch on: iOS throws
`PluginError(code: "ERR_PERMISSION_DENIED", message: "Camera access was denied")`, Android calls
`promise.reject(code = "ERR_PERMISSION_DENIED", errorMessage = "Camera access was denied")` (or throws a
`PluginException`). JavaScript gets a `NativeError` whose `code` is that one. Use these codes when
they fit, so apps handle every package the same way:

| Code                    | When                                                |
| ----------------------- | --------------------------------------------------- |
| `ERR_PERMISSION_DENIED` | The user denied the permission the function needs.  |
| `ERR_UNAVAILABLE`       | The device or OS version can't do it.               |
| `ERR_CANCELED`          | The user dismissed it (a picker, a prompt).         |
| `ERR_INVALID_ARGUMENT`  | JavaScript passed something the function can't use. |

```ts
try {
  await takePhoto()
} catch (error) {
  if (error instanceof NativeError && error.code === 'ERR_CANCELED') return
  throw error
}
```

### The app's lifecycle

On iOS, a plugin that also conforms to `AppLifecycleListener` hears the app's events; implement only
the ones you need:

```swift
public final class PushPlugin: NativuePlugin, AppLifecycleListener, NotificationCenterListener {
    public func didRegisterForRemoteNotifications(deviceToken: Data) { /* keep it, send it to JS */ }

    public func didReceiveRemoteNotification(_ userInfo: [AnyHashable: Any]) async -> UIBackgroundFetchResult {
        .newData
    }

    /// Before JavaScript's onOpenURL and the router; true: the URL is taken.
    public func open(url: URL) -> Bool { url.scheme == "com.googleusercontent.apps.123" }

    public func willPresent(_ notification: UNNotification) async -> UNNotificationPresentationOptions? {
        [.banner, .sound]
    }
}
```

- nativue is the notification center's delegate; never set `UNUserNotificationCenter.current().delegate`.
  `willPresent` answers add up (nil leaves it to the others; with none, the notification isn't shown
  while the app is open), and every `didReceive` runs.
- Listeners of a remote notification run at once; the app reports `newData` if any had new data.
  nativue stops waiting for listeners after 25 seconds, before iOS's 30.

On Android, plugins live as long as the app's process, in one `PluginRegistry`, which a service
started with the app closed (a push arriving) gets with `PluginRegistry.get(this)`. `register` runs
each time the activity is created: only add functions and views there, and keep state the plugin
must not lose in its own fields. So:

- Use `registry.applicationContext` for system services. `registry.activity` is the activity on
  screen, or null: read it when you need it and never keep it, since it's replaced when the activity
  is recreated. `registry.requireActivity()` throws `ERR_UNAVAILABLE` when there's none.
  (`registry.context`, from before, is deprecated.)
- A plugin that implements `ActivityListener` gets `onActivityCreated(activity)` each time the
  activity is created, and `onActivityDestroyed(activity)` when one goes away. Register
  activity-result launchers there, every time and in the same order, and listen for new intents with
  `activity.addOnNewIntentListener`. Its `open(url)` returning true takes a URL the app was opened
  with before JavaScript's `onOpenURL` and the router, as on iOS.
- Android may kill the app while another activity (the camera) is in front, and the result then
  reaches a new process. Save what you need to read it (its options, the output file) in
  `SharedPreferences` before launching; if no call is waiting when the result comes, keep the result
  there, and give JavaScript a `getPendingResult()` that returns it once, for the app to call when it
  starts.

### Changing the app's native files

A package whose native code needs something in the app's `Info.plist`, entitlements, manifest or
strings declares a plugin in its `package.json`, next to its native code:

```json
"nativue": {
  "plugin": "./plugin.mjs",
  "ios": { "sources": "ios", "plugin": "PushPlugin" }
}
```

`plugin.mjs` exports by default a function from options to a plugin named after the package. Its
mods change each document in place, when `nativue prebuild` generates `ios/` and `android/`:

```js
export default function push({ channelName = 'Updates' } = {}) {
  return {
    name: '@acme/push',
    ios: {
      infoPlist(infoPlist) {
        infoPlist.UIBackgroundModes = [
          ...(infoPlist.UIBackgroundModes ?? []),
          'remote-notification',
        ]
      },
      entitlements(entitlements) {
        entitlements['aps-environment'] = 'production'
      },
    },
    android: {
      // The app's manifest: { tag, attributes, children }, attributes with their prefix.
      manifest(manifest) {
        const application = manifest.children.find((child) => child.tag === 'application')
        application.children.push({
          tag: 'meta-data',
          attributes: { 'android:name': 'push.channel', 'android:value': 'default' },
          children: [],
        })
      },
      strings(strings) {
        strings.push_channel_name = channelName
      },
    },
  }
}
```

- A plugin can also add `resources`, with the shape of the [app config's](app-config.md#resources)
  and absolute paths (`fileURLToPath(new URL('./chime.wav', import.meta.url))`), and change the
  app's Gradle files with an `android.gradle` mod: `dependencies`, `plugins`, `repositories`,
  `manifestPlaceholders`, `properties`. Its own dependencies belong in its `build.gradle.kts`.
- The app applies it without options, with nothing to configure. To pass options, the app lists it
  in `plugins` (`plugins: [push({ channelName: 'News' })]`), which replaces the default one.
- Plugins run in the order of the app's dependencies, then `plugins`, and the app's own fields
  (`ios.infoPlist`, `android.permissions`...) apply last: the app always wins.
- Permissions and components the package always uses go in its own `AndroidManifest.xml`, which
  Gradle merges into the app. The `manifest` mod is for what depends on options, or must be in the
  app's manifest.
- An `ios.targets` mod adds an iOS app extension (below) the app embeds.
- An app with `prebuild: false` keeps its native files by hand: `dev`, `build` and `run` stop and
  list what the plugins add that its files lack, to paste in. Its mods then get a `config` with
  only `prebuild` and `plugins`.

## Native code in your app

An app's own native code goes in `native/`, one folder per feature, with the same plugins as a
package, without a `package.json` or a `build.gradle.kts`:

```
native/
  battery/
    ios/BatteryPlugin.swift
    android/BatteryPlugin.kt
```

Each folder's plugin is named after it (`battery` → `BatteryPlugin`, `face-id` → `FaceIdPlugin`), and a
folder with only `ios/` or `android/` adds it on that platform only:

- **iOS:** a public class with a public `init()`, as above. The folder becomes the Swift module
  `App<Name>` (`AppBattery`), so a folder named like a system framework (`photos`) doesn't hide it.
- **Android:** a Kotlin or Java class with no `package` line, compiled into the app: it can use the
  app's dependencies.

```kotlin
import android.content.Context
import android.os.BatteryManager
import dev.nativue.NativuePlugin
import dev.nativue.PluginRegistry

class BatteryPlugin : NativuePlugin {
    override fun register(registry: PluginRegistry) {
        val batteryManager = registry.applicationContext.getSystemService(Context.BATTERY_SERVICE) as BatteryManager

        registry.addFunction("battery.level") {
            batteryManager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) / 100.0
        }
    }
}
```

Libraries the native code uses go in the folder's `nativue.json`: Swift packages for iOS, Maven
libraries for Android (from Google's Maven and Maven Central).

```json
{
  "ios": {
    "dependencies": [
      {
        "url": "https://github.com/apple/swift-collections",
        "from": "1.1.0",
        "products": ["DequeModule"]
      }
    ]
  },
  "android": { "dependencies": ["com.google.code.gson:gson:2.11.0"] }
}
```

A package lists its Swift packages the same way, in `"nativue": { "ios": { "dependencies": [...] } }`;
its Android libraries go in its `build.gradle.kts`.

### iOS app extensions

A Notification Service Extension, a widget or a share extension is its own target in the Xcode
project, built from a folder of Swift files. It's plain Swift: it doesn't link nativue, and doesn't
run JavaScript.

An app puts one in `native/extensions/<name>/`, with a `nativue.json`:

```
native/
  extensions/
    Widget/
      Widget.swift
      nativue.json   { "ios": { "target": { "type": "widget", "bundleIdSuffix": ".Widget" } } }
```

A package adds one with its plugin's `ios.targets` mod:

```js
import { fileURLToPath } from 'node:url'

// in the plugin's ios:
targets(targets) {
  targets.push({
    name: 'NotificationService',
    type: 'notification-service',
    sources: fileURLToPath(new URL('./ios-extension', import.meta.url)),
    bundleIdSuffix: '.NotificationService',
    infoPlist: {
      NSExtension: { NSExtensionPrincipalClass: '$(PRODUCT_MODULE_NAME).NotificationService' },
    },
  })
},
```

- `type`: `notification-service`, `notification-content`, `widget` or `share`. Its
  `NSExtensionPointIdentifier` is set; `infoPlist` adds the rest, like the principal class.
- The bundle id is the app's plus `bundleIdSuffix`. The version, build number and team are the app's.
- Its Swift module is `App<Name>` (`AppNotificationService`), as for `native/` modules: name the
  principal class `$(PRODUCT_MODULE_NAME).<Class>`.
- `appGroups: true` gives the extension the app's `ios.appGroups`, to share files and
  `UserDefaults(suiteName:)` with it. `entitlements`, `deploymentTarget` (the app's, 15.1, by default)
  and `buildSettings` set the rest.
- `ios/Extensions/<name>` links to the folder: edits to its Swift files are built without a
  prebuild.

Native changes need the app rebuilt with `npm run ios` or `npm run android`, not just a reload. To turn
a folder into a package later, move it out and add a `package.json` with its `"nativue"` field (and,
for Android libraries, a `build.gradle.kts`).
