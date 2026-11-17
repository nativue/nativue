# App template

`packages/create-vue-native/template/` is what every new app starts from. When a change to the
framework (`packages/vuenative`, `packages/vuenative-icons`, the CLI) or to the demo's host app
(`examples/demo/ios`, `package.json`, `tsconfig.json`) affects how an app is set up, update the
template in the same change, for example:

- the iOS host app: `App.xcodeproj` settings or build phases, `Info.plist` keys, `App.swift`, assets
- the app's `package.json` scripts or dependencies, `tsconfig.json`, `.gitignore` (shipped as
  `template/gitignore`), `src/env.d.ts`
- a renamed or removed API that `template/src` uses
- a new platform folder (e.g. `android/`) or file every app needs

Keep the demo's host app and the template's in step: they differ only in names and the path to the
Swift package (`../../../packages/vuenative` in the demo, `../node_modules/vuenative` in the template).

After such a change, check a generated app still works end to end: `npm pack` vuenative, create an
app with `node packages/create-vue-native/index.mjs` in the scratchpad, install the tarball, then
`npm run build`, `npm run typecheck` and an iOS build.
