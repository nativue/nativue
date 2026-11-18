# @nativue/core

Vue for real native apps on iOS and Android: Vue components rendered as the platform's own views,
UIKit on iOS and Android views with Material 3 on Android, laid out with flexbox.

Start a new app with:

```sh
npm create nativue@latest my-app
```

This package holds:

- the runtime: the renderer, native components, the router, `Animated`, `AsyncStorage`, `fetch`
- the native side: a Swift package for iOS and a Gradle library for Android
- the `nativue` CLI:

```sh
nativue run ios          # or android: builds, opens the app on a simulator or emulator, then dev
nativue dev              # rebuilds on save and reloads the running app
nativue build            # bundles the app into ios/ and android/ (--production for releases)
```

## Documentation

- [Getting started](https://github.com/nativue/nativue/blob/main/docs/getting-started.md)
- [Components](https://github.com/nativue/nativue/blob/main/docs/components/README.md)
- [Styling](https://github.com/nativue/nativue/blob/main/docs/styling.md)
- [Navigation](https://github.com/nativue/nativue/blob/main/docs/navigation.md)
- [Animations and gestures](https://github.com/nativue/nativue/blob/main/docs/animations.md)
- [APIs](https://github.com/nativue/nativue/blob/main/docs/apis.md)
- [Packages](https://github.com/nativue/nativue/blob/main/docs/packages.md)
