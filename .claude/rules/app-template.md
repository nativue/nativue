# App template

`packages/create-nativue/template/` is what every new app starts from. When a change to the
framework (`packages/core`, `packages/icons`, the CLI) or to the demo's host app
(`examples/demo/ios`, `package.json`, `tsconfig.json`) affects how an app is set up, update the
template in the same change, for example:

- the iOS host app: `App.xcodeproj` settings or build phases, `Info.plist` keys, `App.swift`, assets
- the app's `package.json` scripts or dependencies, `tsconfig.json`, `.gitignore` (shipped as
  `template/gitignore`), `src/env.d.ts`
- a renamed or removed API that `template/src` uses
- a new platform folder (e.g. `android/`) or file every app needs

When a change adds, renames or removes something apps use (a component, prop, API, route feature or
package), update `packages/core/AGENTS.md` too: it's the guide coding agents read in every app.

Keep the demo's host app and the template's in step: they differ only in names and the path to the
Swift package (`../../../packages/core` in the demo, `../node_modules/@nativue/core` in the template).

After such a change, check a generated app still works end to end: `npm pack` @nativue/core, create an
app with `node packages/create-nativue/index.mjs` in the scratchpad, install the tarball, then
`npm run build`, `npm run typecheck` and an iOS build.
