<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/logo-horizontal-dark.svg" />
    <img src=".github/logo-horizontal.svg" width="360" alt="vue-native" />
  </picture>
</p>

# Vue Native

Vue rendering real iOS views: a custom Vue renderer runs in JavaScriptCore and drives UIKit through
a native bridge, with Yoga for flexbox layout.

## Create an app

```sh
npm create vue-native@latest my-app    # add -- --bundle-id com.company.myapp to set it now
cd my-app
npm install
npm run dev                            # keep it running: rebuilds and reloads the app on save
open ios/App.xcodeproj                 # pick a simulator or your iPhone, then Run
```

## Repository

```
packages/vuenative/     the framework (npm package "vuenative")
  src/                  runtime: renderer, router, Animated, AsyncStorage, fetch, types
  ios/ + Package.swift  native side, a Swift Package (bridge, views, Yoga)
  cli/                  `vuenative dev` and `vuenative build` (bundler + dev server)
  test/                 runs the demo's bundle against a fake native side
packages/vuenative-icons/  icon sets as components, drawn by the native <Svg>
  src/lucide.ts         generated from lucide (`npm run generate -w vuenative-icons`)
packages/create-vue-native/  `npm create vue-native`: copies template/ and fills in the app's names
examples/demo/          an app, laid out like any Vue Native project
```

Icons: `import { HeartIcon } from 'vuenative-icons/lucide'`, then
`<HeartIcon :size="24" color="#ff3b30" :stroke-width="2" />`. Only the icons you import end up in
the bundle.
They also work as tab icons: `<Tabs.Screen :options="{ tabBarIcon: HouseIcon }" />`.

## An app

```
src/
  app/          routes, one file per screen (_layout.vue, [param].vue, (group)/)
  assets/       images and other files
  components/   shared components (optional)
  lib/          everything else: stores, theme, helpers (optional)
ios/            App.xcodeproj, the same in every app: App.swift shows VueNativeView()
```

`@/` points at `src/` from anywhere: `import { colors } from '@/lib/theme'`.

Code imports the runtime from `vue` (`ref`, `Animated`, `StyleSheet`...) and the router from
`vuenative/router`. TypeScript is the default: `tsconfig.json` extends `vuenative/tsconfig.base.json`.

## Commands

From the repository root:

| Command             | What it does                                                 |
| ------------------- | ------------------------------------------------------------ |
| `npm run dev`       | rebuilds the demo on save and hot-reloads the running app    |
| `npm run build`     | bundles the demo into `examples/demo/ios/App/main.bundle.js` |
| `npm test`          | builds the demo and runs the framework tests                 |
| `npm run typecheck` | type-checks the framework and the demo                       |
| `npm run format`    | formats everything with Prettier                             |

Open `examples/demo/ios/App.xcodeproj` in Xcode to run the app on a simulator or device.
