# @nativue/core

Vue rendering real native views on iOS and Android: UIKit on iOS, Android views with Material 3 on
Android, laid out with Yoga.

Start a new app with:

```sh
npm create nativue@latest my-app
```

This package holds the runtime (renderer, router, Animated, AsyncStorage, fetch), the native side
for iOS (a Swift package) and Android (a Gradle library), and the `nativue` CLI:

```sh
nativue run ios          # or android: builds, opens the app on a simulator or emulator, then dev
nativue dev              # rebuilds on save and reloads the running app
nativue build            # bundles the app into ios/ and android/ (--production for releases)
```

Docs: https://github.com/nativue/nativue/tree/main/docs
