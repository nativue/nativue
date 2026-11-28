# @nativue/biometrics

Face ID, Touch ID and fingerprint in [nativue](https://github.com/nativue/nativue) apps: check it's
the device's owner before something sensitive.

```sh
npm install @nativue/biometrics
```

Then rebuild the app (`npm run ios`, `npm run android`): its native code is linked when the app is
built.

```ts
import { Biometrics } from '@nativue/biometrics'

const { enrolled } = await Biometrics.getStatus()

if (enrolled) {
  const result = await Biometrics.authenticate({ reason: 'Unlock your notes' })

  if (result.success) showNotes()
  else if (result.error !== 'canceled') showError(result.error)
}
```

## getStatus()

| Field       |                                                             |
| ----------- | ----------------------------------------------------------- |
| `available` | the device can check a face or a fingerprint, set up or not |
| `enrolled`  | the user set one up: `authenticate` can work                |
| `types`     | `'face'`, `'fingerprint'`, `'iris'`: the sensors it has     |

On Android, `types` lists the sensors the device has, which may be more than the user set up.

## authenticate(options)

| Option                  |                                                                       |
| ----------------------- | --------------------------------------------------------------------- |
| `reason`                | what it's for: iOS shows it in the prompt, Android under the title    |
| `title`                 | Android: the prompt's title; the reason when there's none             |
| `cancelLabel`           | the button that gives up                                              |
| `allowDeviceCredential` | the passcode, PIN or pattern can stand in for the face or fingerprint |

It resolves `{ success: true }`, or `{ success: false, error }`: a cancel is an answer, not an
exception.

| `error`         | When                                                                  |
| --------------- | --------------------------------------------------------------------- |
| `canceled`      | the user canceled                                                     |
| `interrupted`   | the system ended it: the app went to the background, a call came in   |
| `lockout`       | too many tries: the device's passcode unlocks biometrics again        |
| `not_enrolled`  | nothing set up (or, with `allowDeviceCredential`, no passcode either) |
| `not_available` | no biometrics on this device, or turned off                           |
| `failed`        | iOS: it didn't match, after the tries it allows (Android locks out)   |

A failed try leaves the prompt open for another; only how it ends answers. On Android, a second call
while a prompt is open rejects with `ERR_UNAVAILABLE`.

On Android it takes class 2 ("weak") biometrics too, as many devices' face unlock is: enough to tell
it's the user, which is what this is for. It doesn't unlock keys; for secrets, keep them in
`@nativue/secure-store`.

## Permissions

iOS asks for Face ID the first time, with a text Apple's review reads: say what it guards, in
`nativue.config.ts`:

```ts
import biometrics from '@nativue/biometrics/plugin'

export default defineConfig({
  plugins: [biometrics({ faceIDPermission: 'Unlock your notes with Face ID' })],
})
```

| Permission                                   | Platform | When                                         |
| -------------------------------------------- | -------- | -------------------------------------------- |
| `NSFaceIDUsageDescription` (the prompt text) | iOS      | always: `faceIDPermission`, or a default     |
| `USE_BIOMETRIC`                              | Android  | always, from androidx.biometric; never asked |
