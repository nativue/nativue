# @nativue/clipboard

Copy text to the clipboard in [nativue](https://github.com/nativue/nativue) apps: `UIPasteboard` on
iOS, `ClipboardManager` on Android.

```sh
npm install @nativue/clipboard
```

Then rebuild the app (`npm run ios`, `npm run android`): its native code is linked when the app is
built.

```ts
import { Clipboard } from '@nativue/clipboard'

const { copied, systemConfirmed } = await Clipboard.copy('https://example.com')
if (copied && !systemConfirmed) showToast('Copied')
```

- `copied`: whether the text is on the clipboard. False when the system refused it, e.g. on Android
  past its ~1MB limit. iOS and Android.
- `systemConfirmed`: whether the system showed its own "copied" confirmation, so the app shouldn't
  show one too. True only on Android 13 and later.
