# App template

A new app is two parts, both generated:

- `packages/create-nativue/template/`: the JS app, copied once by `npm create nativue` (`src`,
  `package.json`, `tsconfig.json`, `nativue.config.ts`, `.gitignore` shipped as `template/gitignore`).
- `ios/` and `android/`: written by `nativue prebuild` (`packages/core/cli/prebuild.mjs`) on every
  `dev`, `build` and `run`, from `packages/core/template/{ios,android}` plus the files it builds from
  `nativue.config.ts` (the Xcode project in `cli/ios-project.mjs`, the Android manifest and strings in
  `cli/android-project.mjs`). Apps, the demo included, don't commit them.

When a change to the framework (`packages/core`, `packages/icons`, the CLI) affects how an app is set
up, update the right part in the same change, for example:

- Xcode settings, build phases or `Info.plist` keys: `cli/ios-project.mjs`; `App.swift` and assets:
  `packages/core/template/ios`
- the Android manifest: `cli/android-project.mjs`; Gradle files and resources:
  `packages/core/template/android`
- a new `nativue.config.ts` field: `cli/config.d.mts`, its validation in `cli/prebuild.mjs`, and the
  template's `nativue.config.ts` when every app needs it
- the app's `package.json` scripts or dependencies, `tsconfig.json`, `.gitignore`, `src/env.d.ts`
- a renamed or removed API that `template/src` uses

Then update the prebuild snapshots (`UPDATE_SNAPSHOTS=1 node packages/core/test/prebuild.test.mjs`)
and review their diff.

When a change adds, renames or removes something apps use (a component, prop, API, route feature or
package), update `packages/core/AGENTS.md` too: it's the guide coding agents read in every app.

After such a change, check a generated app still works end to end: `npm pack` @nativue/core, create an
app with `node packages/create-nativue/index.mjs` in the scratchpad, install the tarball, then
`npm run build`, `npm run typecheck`, and the iOS and Android builds.
