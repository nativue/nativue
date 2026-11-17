# Vue Native

Vue rendering real iOS views: a custom Vue renderer runs in JavaScriptCore and drives UIKit through
a native bridge, with Yoga for flexbox layout. Like React Native, with Vue.

## Repository

```
packages/vuenative/     the framework (npm package "vuenative")
  src/                  runtime: renderer, router, Animated, AsyncStorage, fetch, types
  ios/ + Package.swift  native side, a Swift Package (bridge, views, Yoga)
  cli/                  `vuenative dev` and `vuenative build` (bundler + dev server)
  test/                 runs the demo's bundle against a fake native side
packages/vuenative-icons/  icon sets as components, drawn by the native <Svg>
  src/lucide.ts         generated from lucide (`npm run generate -w vuenative-icons`)
examples/demo/          an app, laid out like any Vue Native project
```

Icons: `import { HeartIcon } from 'vuenative-icons/lucide'`, then
`<HeartIcon :size="24" color="#ff3b30" :stroke-width="2" />`. Only the icons you import end up in
the bundle.

## An app

```
src/
  app/          routes, file-based like expo-router (_layout.vue, [param].vue, (group)/)
  assets/
  ...           anything else: components/, stores, theme...
ios/            thin host app: App.swift shows VueNativeView()
```

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

Open `examples/demo/ios/Demo.xcodeproj` in Xcode to run the app on a simulator or device.
