# Getting started

## Requirements

- **Node.js** 20.19 or later
- **iOS:** a Mac with Xcode. Apps run on iOS 17 or later.
- **Android:** Android Studio, with an emulator or a phone. Apps run on Android 11 (API 30) or
  later. Without `JAVA_HOME`, the build uses the JDK inside Android Studio.

## Create an app

```sh
npm create nativue@latest my-app
cd my-app
npm install
```

The app's bundle id defaults to `com.example.myapp`. Set yours now with
`npm create nativue@latest my-app -- --bundle-id com.company.myapp`, or later in Xcode and in
`android/app/build.gradle.kts`.

## Run it

```sh
npm run ios        # an iOS simulator
npm run android    # an Android emulator
```

Each one builds the app, opens it on a simulator or emulator (starting one if none is running) and
then runs the dev server. Save a file and the app reloads with your change.

If a dev server is already running, they only build and open the app, and it connects to that
server. `--no-dev` never starts one: `npm run ios -- --no-dev`. To run the dev server alone:

```sh
npm run dev
```

Changes to JavaScript, Vue files and assets reload right away. After you install a package with
native code, run `npm run ios` or `npm run android` again: native code is linked when the app is
built.

### Run on a phone

Connect the phone with USB, then:

```sh
npm run ios -- --device        # the first iPhone connected
npm run android -- --device    # the first Android phone, with USB debugging on
```

`--device <name or id>` picks a given phone, simulator or emulator, e.g.
`npm run ios -- --device "iPhone 16"`; an unknown one lists what's available.

On iOS, a phone only runs signed apps: sign in to your Apple account in Xcode > Settings > Accounts
once. The app is signed with your development team, or the one picked under Signing & Capabilities
in `ios/App.xcodeproj` (needed if you're in several). You can also press Run in Xcode, or in Android
Studio for the `android` folder, with `npm run dev` running.

A debug build finds the dev server by itself. An iPhone reaches it through the computer's local
address on the same Wi-Fi, which is written into the app when it's built: build again after switching
networks. An Android phone on USB reaches it through `adb reverse`, which `--device` sets up.

## Project structure

```
src/
  app/             routes, one file per screen (see Navigation)
  assets/          images and other files
  components/      shared components (optional)
  lib/             everything else: stores, theme, helpers (optional)
  app.ts           sets the app up before it starts: Vue plugins like Pinia (optional)
  tailwind.css     the Tailwind theme, with @nativue/tailwind (optional)
ios/               the iOS app (App.xcodeproj): App.swift shows NativueView()
  NativuePlugins/  generated: nativue and the iOS side of your native packages
android/           the Android app: MainActivity extends NativueActivity
nativue.config.ts  plugins, e.g. @nativue/tailwind (optional)
```

- `@/` points at `src/` from anywhere: `import { colors } from '@/lib/theme'`.
- Import the runtime from `vue`: `ref`, `computed`, `StyleSheet`, `Animated`, `Platform`...
- Import navigation from `@nativue/core/router`: `Stack`, `Tabs`, `Link`, `router`...
- Components like `View` and `Text` are global: no import needed.
- TypeScript is the default. `tsconfig.json` extends `@nativue/core/tsconfig.base.json`, and
  `npm run typecheck` checks your templates too.
- Images are imported like modules: `import logo from '@/assets/logo.png'`, then
  `<Image :source="logo" />`.

### Vue plugins

There's no `main.ts`: nativue creates the app from your routes. To install a Vue plugin (Pinia,
TanStack Query, vue-i18n...), export a function from `src/app.ts`. It gets the app before it mounts:

```ts
// src/app.ts
import type { App } from 'vue'
import { createPinia } from 'pinia'
import { VueQueryPlugin } from '@tanstack/vue-query'

export default function setup(app: App) {
  app.use(createPinia())
  app.use(VueQueryPlugin)
}
```

## Errors

In development, an error shows on a red screen with its message and stack, mapped to your source
files. Errors in templates, `setup`, lifecycle hooks and event handlers name the component they came
from. Fix the file and save: the app reloads.

## Release builds

```sh
npm run build
```

This bundles the app for production: minified and compiled to bytecode for faster startup, and
written into `ios/` and `android/`. Then build the release as you would any native app:

- **iOS:** in Xcode, Product → Archive.
- **Android:** in Android Studio, Build → Generate Signed App Bundle or APK.

Run `npm run build` again before each release build: the native project uses the bundle it finds.

## Next steps

- [Components](components/README.md)
- [Styling](styling.md)
- [Navigation](navigation.md)
