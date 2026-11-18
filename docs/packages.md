# Packages

| Package                                               | What it adds                                                                 |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| [`@nativue/icons`](../packages/icons/README.md)       | 2,000+ Lucide icons as components, drawn natively; also tab and header icons |
| [`@nativue/tailwind`](../packages/tailwind/README.md) | Tailwind CSS classes, turned into native styles when the app is built        |
| [`@nativue/haptics`](../packages/haptics/README.md)   | haptic feedback                                                              |
| [`@nativue/sqlite`](../packages/sqlite/README.md)     | SQLite databases                                                             |

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

A plugin is an object with a `name`, Vite plugins for the build (`vite`), and a module the app
imports before it starts (`runtime`).

## Writing a package with native code

[`@nativue/haptics`](../packages/haptics) is a small example of one. A package's `package.json` says where its native code is:

```json
"nativue": {
  "ios": { "sources": "ios", "plugin": "HapticsPlugin" },
  "android": { "sources": "android", "plugin": "dev.nativue.haptics.HapticsPlugin" }
}
```

Apps find it among their dependencies, with nothing to configure:

- **iOS:** the nativue CLI (`dev`, `build`, `run`) writes `ios/NativuePlugins`, a Swift package with
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
