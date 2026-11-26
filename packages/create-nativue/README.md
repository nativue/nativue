# create-nativue

Creates a [nativue](https://github.com/nativue/nativue) app, with its iOS and Android projects:

```sh
npm create nativue@latest my-app
cd my-app
npm install
npm run ios                         # or: npm run android
```

The app's bundle id defaults to `com.example.myapp`. Set yours with
`npm create nativue@latest my-app -- --bundle-id com.company.myapp`, or later in `nativue.config.ts`.
`ios/` and `android/` are generated from that file, the first time you run the app.

The new app has a starter screen, TypeScript, and these scripts:

| Script              | What it does                                                           |
| ------------------- | ---------------------------------------------------------------------- |
| `npm run ios`       | builds the app, opens it on an iOS simulator, then runs the dev server |
| `npm run android`   | the same on an Android emulator                                        |
| `npm run dev`       | the dev server alone: the app reloads on save                          |
| `npm run build`     | bundles the app for a release build                                    |
| `npm run typecheck` | type-checks the app, templates included                                |

Next: [Getting started](https://github.com/nativue/nativue/blob/main/docs/getting-started.md).
