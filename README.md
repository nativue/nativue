<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/logo-horizontal-dark.svg" />
    <img src=".github/logo-horizontal.svg" width="288" alt="nativue" />
  </picture>
</p>

# Nativue

Vue rendering real native views on iOS and Android: a custom Vue renderer drives the platform's own
views through a native bridge, with Yoga for flexbox layout. On iOS it runs in JavaScriptCore and
drives UIKit; on Android it runs in Hermes and drives Android views, with Material 3 navigation.

## Create an app

```sh
npm create nativue@latest my-app    # add -- --bundle-id com.company.myapp to set it now
cd my-app
npm install
npm run dev                            # keep it running: rebuilds and reloads the app on save
open ios/App.xcodeproj                 # iOS: pick a simulator or your iPhone, then Run
```

On Android, open the `android` folder in Android Studio and press Run, or start an emulator and run
`cd android && ./gradlew installDebug`. It needs Android 11 (API 30) or later and JDK 17+.

A debug build finds the dev server by itself: the simulator or emulator through the computer, a
phone on the same Wi-Fi through the computer's local address (written into the app when it's built,
so build again after switching networks). An Android phone on USB can also use
`adb reverse tcp:42883 tcp:42883`.

## Platforms

The same code runs on both, and each looks native:

- Navigation: UIKit's navigation and tab bars on iOS; Material 3 top app bar, bottom navigation bar,
  slide transitions and the system back gesture on Android.
- `<Modal>` with `pageSheet` / `formSheet` and `presentation: 'formSheet'` routes: a native sheet on
  iOS, a Material bottom sheet on Android.
- Errors in development: the same red screen, with the stack mapped to your files.
- SF Symbols (`tabBarIcon: 'house'`, `icon: 'gear'` on header items) are iOS-only; icons from
  `@nativue/icons` draw on both.
- `tabBarBackgroundColor` applies on Android and iOS 18; iOS 26+ keeps its glass tab bar.

## Repository

```
packages/core/          the framework (npm package "@nativue/core")
  src/                  runtime: renderer, router, Animated, AsyncStorage, fetch, types
  ios/ + Package.swift  iOS native side, a Swift Package (bridge, views, Yoga)
  android/              Android native side, a Gradle library (Hermes, JNI bridge, views, Yoga)
  cli/                  `nativue dev` and `nativue build` (bundler + dev server)
  test/                 runs the demo's bundle against a fake native side
packages/icons/         icon sets as components, drawn by the native <Svg>
  src/lucide.ts         generated from lucide (`npm run generate -w @nativue/icons`)
packages/create-nativue/ `npm create nativue`: copies template/ and fills in the app's names
examples/demo/          an app, laid out like any Nativue project
```

Icons: `import { HeartIcon } from '@nativue/icons/lucide'`, then
`<HeartIcon :size="24" color="#ff3b30" :stroke-width="2" />`. Only the icons you import end up in
the bundle.
They also work as tab icons, `<Tabs.Screen :options="{ tabBarIcon: HouseIcon }" />`, and on header
buttons, `headerRight: [{ title: 'Settings', icon: SettingsIcon, onPress }]` (the title names it for
screen readers).

## An app

```
src/
  app/          routes, one file per screen (_layout.vue, [param].vue, (group)/)
  assets/       images and other files
  components/   shared components (optional)
  lib/          everything else: stores, theme, helpers (optional)
ios/            App.xcodeproj, the same in every app: App.swift shows NativueView()
android/        the Android app, the same in every app: MainActivity extends NativueActivity
```

`@/` points at `src/` from anywhere: `import { colors } from '@/lib/theme'`.

Code imports the runtime from `vue` (`ref`, `Animated`, `StyleSheet`...) and the router from
`@nativue/core/router`. TypeScript is the default: `tsconfig.json` extends
`@nativue/core/tsconfig.base.json`.

## Commands

From the repository root:

| Command             | What it does                                              |
| ------------------- | --------------------------------------------------------- |
| `npm run dev`       | rebuilds the demo on save and hot-reloads the running app |
| `npm run build`     | bundles the demo into its iOS and Android apps            |
| `npm test`          | builds the demo and runs the framework tests              |
| `npm run typecheck` | type-checks the framework and the demo                    |
| `npm run format`    | formats everything with Prettier                          |

Open `examples/demo/ios/App.xcodeproj` in Xcode, or `examples/demo/android` in Android Studio, to run
the app on a simulator, emulator or device.
