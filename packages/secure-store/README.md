# @nativue/secure-store

Small secrets (tokens, passwords) in [nativue](https://github.com/nativue/nativue) apps, encrypted by
the system: the Keychain on iOS, a key of the Android Keystore on Android.

```sh
npm install @nativue/secure-store
```

Then rebuild the app (`npm run ios`, `npm run android`): its native code is linked when the app is
built.

```ts
import { SecureStore } from '@nativue/secure-store'

await SecureStore.setItem('token', token)
const token = await SecureStore.getItem('token') // string, or null when there's none
await SecureStore.deleteItem('token')
```

Values are strings: store objects as JSON. For data that isn't secret, `AsyncStorage` is simpler; for
much of it, `@nativue/sqlite`.

## When it can be read (iOS)

```ts
await SecureStore.setItem('token', token, { accessible: 'afterFirstUnlock' })
```

| `accessible`                       | Readable                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| `'whenUnlocked'` (the default)     | while the device is unlocked                                                      |
| `'afterFirstUnlock'`               | also while it's locked, once it was unlocked after a restart: for background work |
| `'whenUnlockedThisDeviceOnly'`     | as `'whenUnlocked'`, and not moved to a new device by an encrypted backup         |
| `'afterFirstUnlockThisDeviceOnly'` | as `'afterFirstUnlock'`, and not moved to a new device                            |

Reading a `'whenUnlocked'` value while the device is locked rejects with `ERR_UNAVAILABLE`. Android
ignores `accessible`.

## How it's kept

- **iOS:** generic passwords in the app's Keychain, under the service `nativue.secure-store`.
- **Android:** each value is encrypted with AES-GCM by a key that the Android Keystore makes for the
  app and never lets out of the device, then kept in the app's `SharedPreferences`. A value restored
  from a backup onto another device can't be decrypted there: it reads as `null`, and is forgotten.
  (Jetpack's EncryptedSharedPreferences is deprecated in favour of using the Keystore directly.)

## Errors

The functions reject with a `NativeError`: `ERR_UNAVAILABLE` when the Keychain or the Keystore
refuses, with the system's message. An empty key or a value that isn't a string throws a `TypeError`.

## Not yet

Reading a value only after Face ID, Touch ID or the fingerprint.
