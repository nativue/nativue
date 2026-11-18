# @nativue/haptics

Haptic feedback for [nativue](https://github.com/nativue/nativue) apps: `UIFeedbackGenerator` on
iOS, the system's haptic feedback on Android. Both follow the user's settings.

```sh
npm install @nativue/haptics
```

Then rebuild the app (`npx nativue run ios`, `npx nativue run android`): its native code is linked
when the app is built.

```ts
import { Haptics } from '@nativue/haptics'

Haptics.impact('light' | 'medium' | 'heavy') // a tap of some weight
Haptics.notification('success' | 'warning' | 'error') // a task's outcome
Haptics.selection() // a picker or segmented control moved
```

Simulators and emulators don't vibrate: try it on a phone.

## Writing a package with native code

This package is a small example of one: see
[Writing a package with native code](https://github.com/nativue/nativue/blob/main/docs/packages.md#writing-a-package-with-native-code).
