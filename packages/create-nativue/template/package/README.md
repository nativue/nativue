# __PACKAGE_NAME__

A [nativue](https://github.com/nativue/nativue) package with native code.

```sh
npm install __PACKAGE_NAME__
```

Then rebuild the app (`npm run ios`, `npm run android`): its native code is linked when the app is
built.

```ts
import { hello } from '__PACKAGE_NAME__'

hello('nativue') // 'Hello, nativue, from iOS'
```

## Developing it

- `src/index.ts` is what apps import; `ios/__PASCAL__Plugin.swift` and
  `android/src/main/java/__KOTLIN_PATH__/__PASCAL__Plugin.kt` are its native side.
- Try it in an app with `npm install ../__NAME__` from the app, then rebuild the app.
- Swift packages it needs go in `package.json`'s `"nativue": { "ios": { "dependencies": [...] } }`,
  Android libraries in `android/build.gradle.kts`.
- To change the app's `Info.plist`, manifest or Gradle files, add a config plugin:
  [packages.md](https://github.com/nativue/nativue/blob/main/docs/packages.md#changing-the-apps-native-files).
