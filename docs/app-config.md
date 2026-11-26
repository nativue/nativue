# App config

`nativue.config.ts` describes the app. `nativue prebuild`, which `dev`, `build` and `run` also run,
generates `ios/` and `android/` from it, so change the app here, not in those folders. Paths are
relative to the app.

```ts
import { defineConfig } from '@nativue/core/config'

export default defineConfig({
  name: 'My App',
  scheme: 'myapp',
  version: '1.2.0',
  buildNumber: 12,
  icon: './assets/icon.png',
  splash: { image: './assets/splash.png', backgroundColor: '#F1F5F9' },
  ios: {
    bundleIdentifier: 'com.company.myapp',
    appleTeamId: 'ABCDE12345',
    infoPlist: { NSCameraUsageDescription: 'Scans receipts' },
  },
  android: {
    package: 'com.company.myapp',
    permissions: ['android.permission.CAMERA'],
  },
  plugins: [],
})
```

| Field                  | What it sets                                                                                                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                 | The name under the app's icon.                                                                                                                                                                                          |
| `scheme`               | Links like `myapp://items/42` open the app ([navigation](navigation.md)). A list keeps old schemes working.                                                                                                             |
| `version`              | The version people see, three numbers. Defaults to `1.0.0`.                                                                                                                                                             |
| `buildNumber`          | Raised for every build sent to the stores: iOS's `CFBundleVersion` and Android's `versionCode`. Defaults to 1.                                                                                                          |
| `icon`                 | A 1024×1024 PNG without transparency, which the App Store refuses. Xcode makes the other sizes.                                                                                                                         |
| `splash`               | The launch screen: `image` (a 360×360 PNG, shown 120 points wide), `darkImage`, `backgroundColor`, `darkBackgroundColor`. Without it, the nativue logo.                                                                 |
| `ios.bundleIdentifier` | The app's id on iOS.                                                                                                                                                                                                    |
| `ios.appleTeamId`      | The team that signs the app for phones, from Signing & Capabilities in Xcode. Not needed when this Mac has a single Apple Development certificate.                                                                      |
| `ios.infoPlist`        | Keys added to `Info.plist`, like the reason shown when the app asks for the camera.                                                                                                                                     |
| `ios.entitlements`     | The app's entitlements, e.g. `{ 'aps-environment': 'development' }`.                                                                                                                                                    |
| `android.package`      | The app's id on Android, and its Kotlin package.                                                                                                                                                                        |
| `android.permissions`  | `<uses-permission>` entries of the manifest.                                                                                                                                                                            |
| `android.adaptiveIcon` | Android 8+'s icon: `foregroundImage`, a square PNG whose logo fits in the middle 61% (launchers crop the rest into their shape), and `backgroundColor`. Without it, `icon` is used, in the shape the launcher gives it. |
| `android.signing`      | Signs release builds, below.                                                                                                                                                                                            |
| `plugins`              | nativue plugins, e.g. `@nativue/tailwind`.                                                                                                                                                                              |
| `prebuild: false`      | Keeps `ios/` and `android/` by hand instead ([migrating](migrating-to-prebuild.md)).                                                                                                                                    |

## Signing Android releases

Keep the upload key outside `android/`, in `credentials/`, which the app's `.gitignore` leaves out:

```sh
keytool -genkeypair -keystore credentials/upload.keystore -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

```ts
android: {
  package: 'com.company.myapp',
  signing: {
    storeFile: './credentials/upload.keystore',
    keyAlias: 'upload',
    storePasswordEnv: 'ANDROID_STORE_PASSWORD',
    keyPasswordEnv: 'ANDROID_KEY_PASSWORD',
  },
},
```

The config holds only the names of the passwords. Gradle reads them when it builds a release, from
`~/.gradle/gradle.properties` (which Android Studio reads too):

```properties
ANDROID_STORE_PASSWORD=...
ANDROID_KEY_PASSWORD=...
```

or from environment variables of those names, as in CI. Debug builds don't need them; a release
build without them stops, naming the missing ones when the task is a release one (`bundleRelease`,
`assembleRelease`), or at signing for broader ones like `assemble`. In CI, keep the keystore as a base64 secret
(`base64 -i credentials/upload.keystore | pbcopy`) and decode it before building:

```yaml
- run: mkdir -p credentials && echo "$ANDROID_KEYSTORE_BASE64" | base64 --decode > credentials/upload.keystore
  env: { ANDROID_KEYSTORE_BASE64: '${{ secrets.ANDROID_KEYSTORE_BASE64 }}' }
- run: npx nativue build --production && cd android && ./gradlew bundleRelease
  env:
    ANDROID_STORE_PASSWORD: ${{ secrets.ANDROID_STORE_PASSWORD }}
    ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
```

Google Play signs what users install with its own key; this one only proves the upload is yours.
