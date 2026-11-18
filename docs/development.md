# Developing nativue

How to run this repository: the framework, its packages and the demo app that exercises them.

## Setup

You need the same as for an app (see [Getting started](getting-started.md#requirements)): Node.js
20.19 or later, Xcode for iOS, Android Studio for Android.

```sh
git clone https://github.com/nativue/nativue.git
cd nativue
npm install
```

The repository is an npm workspace: `npm install` at the root links the packages to each other and
to the demo.

## Run the demo

The demo app, in `examples/demo`, shows every feature: components, navigation, lists, animations,
gestures, Tailwind, haptics, data and errors. It uses the packages from this repository, so a change
to the framework shows up in it right away.

```sh
npm run ios        # builds the demo, opens it on an iOS simulator, then runs the dev server
npm run android    # the same on an Android emulator
npm run dev        # only the dev server, when the app is already installed
```

Save a file, in the demo or in `packages/core/src`, and the app reloads. Changes to native code
(`packages/core/ios`, `packages/core/android`) need a new build: run `npm run ios` or
`npm run android` again.

To run it on a phone, start `npm run dev`, then open `examples/demo/ios/App.xcodeproj` in Xcode or
`examples/demo/android` in Android Studio and press Run. On iOS, pick your team under Signing &
Capabilities first.

The demo's screens live in `examples/demo/src/app`, one file per screen: they're also the best
examples of each feature.

## Commands

From the repository root:

| Command             | What it does                                                  |
| ------------------- | ------------------------------------------------------------- |
| `npm run ios`       | opens the demo on an iOS simulator, then runs `dev`           |
| `npm run android`   | opens the demo on an Android emulator, then runs `dev`        |
| `npm run dev`       | rebuilds the demo on save and reloads the running app         |
| `npm run build`     | bundles the demo into its iOS and Android apps                |
| `npm test`          | builds the demo and runs the framework's and Tailwind's tests |
| `npm run typecheck` | type-checks the framework, the packages and the demo          |
| `npm run format`    | formats everything with Prettier                              |

## Repository

```
packages/core/            the framework (npm package "@nativue/core")
  src/                    runtime: renderer, router, components, Animated, AsyncStorage, fetch, types
  ios/ + Package.swift    iOS native side, a Swift package (bridge, views, Yoga)
  android/                Android native side, a Gradle library (Hermes, JNI bridge, views, Yoga)
  cli/                    the `nativue` command: dev server, bundler, run on simulators
  test/                   runs the demo's bundle against a fake native side
packages/icons/           icon sets as components, drawn by the native <Svg>
  src/lucide.ts           generated from lucide: `npm run generate -w @nativue/icons`
packages/tailwind/        Tailwind CSS classes, converted to native styles when the app is built
packages/haptics/         haptic feedback, an example of a package with native code
packages/create-nativue/  `npm create nativue`: copies template/ and fills in the app's names
examples/demo/            the demo app, laid out like any nativue app
docs/                     this documentation
```

## How it works

- **Renderer:** `packages/core/src/renderer.ts` is a custom Vue renderer. Instead of DOM nodes, it
  creates native views through `__native`, a bridge object the native side installs in the
  JavaScript engine (Hermes, on both platforms).
- **Layout:** the native side lays out views with Yoga, the flexbox engine, and applies styles.
- **Events:** native views call `__dispatch(nodeId, eventName, payload)`, which runs the Vue
  handler.
- **Bundling:** the CLI bundles the app with Vite into one script, `main.bundle.js`, which the dev
  server sends to the app on every change. Production builds compile it to Hermes bytecode.

## Tests

```sh
npm test
```

- `packages/core/test/test.mjs` builds the demo and runs its bundle against a fake native side,
  checking the views it creates and how they react to events: rendering, styles, navigation, lists,
  animations, storage, fetch.
- `packages/tailwind/test/test.mjs` checks the conversion of Tailwind's CSS into native styles.

Native code has no automated tests: check changes in the demo, on both platforms.

## The app template

`packages/create-nativue/template` is what every new app starts from. It must stay in step with the
demo's host apps (`examples/demo/ios`, `examples/demo/android`): they differ only in names and in the
path to `@nativue/core`. When a change affects how an app is set up (Xcode settings, `Info.plist`,
Gradle files, `package.json` scripts, `tsconfig.json`), update the template in the same change.

To check that a new app still works end to end:

```sh
npm pack -w @nativue/core                        # a tarball of the framework
node packages/create-nativue/index.mjs /tmp/test-app
cd /tmp/test-app
npm install /path/to/nativue-core-x.y.z.tgz
npm run build && npm run typecheck && npm run ios
```

## Code style

- Prettier formats JavaScript, TypeScript and Vue: single quotes, no semicolons (`npm run format`).
- Descriptive names, no abbreviations: `element`, not `el`.
- Comments explain why, not what.
- Commits follow Conventional Commits: `feat(ios): add image component`, `fix: …`, `docs: …`.

## Releasing

1. Bump the versions of the packages that changed, in their `package.json`. `@nativue/core` and
   `create-nativue` share a version: new apps depend on the `@nativue/core` matching
   `create-nativue`'s.
2. Commit as `chore: release x.y.z` and push.
3. Publish the changed packages:
   `npm publish -w @nativue/core -w create-nativue -w @nativue/tailwind -w @nativue/haptics`.
