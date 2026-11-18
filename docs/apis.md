# APIs

Everything here is imported from `vue`, next to `ref` and `computed`:

```ts
import { AsyncStorage, Dimensions, Keyboard, Platform } from 'vue'
```

## AsyncStorage

Keeps strings across launches, like the web's `localStorage`, behind promises:

```ts
await AsyncStorage.setItem('theme', 'dark')
const theme = await AsyncStorage.getItem('theme') // 'dark', or null when missing
```

|                               |                                               |
| ----------------------------- | --------------------------------------------- |
| `getItem(key)`                | the value, or `null`                          |
| `setItem(key, value)`         | saves it; numbers and booleans become strings |
| `removeItem(key)`             |                                               |
| `getAllKeys()`                | every key                                     |
| `multiGet(keys)`              | `[key, value][]`                              |
| `multiSet([[key, value], …])` |                                               |
| `multiRemove(keys)`           |                                               |
| `clear()`                     | removes everything                            |

Values are kept in memory, so reads are fast, and saved to disk in the background. For objects,
store JSON: `setItem('user', JSON.stringify(user))`.

Each save rewrites the whole store: it's meant for settings and small data, not large datasets.

## fetch

The web's `fetch`, run by the platform's networking. No import needed:

```ts
const response = await fetch('https://api.example.com/posts', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'Hello' }),
})

if (!response.ok) throw new Error(`HTTP ${response.status}`)
const post = await response.json()
```

`Response` has `ok`, `status`, `headers`, `url`, `text()` and `json()`. `Headers` has `get`, `set`,
`has` and `forEach`; header names are case-insensitive.

### Uploading files

A `FormData` body is sent as `multipart/form-data`. Text fields go as they are; a file is
`{ uri, name, type }`, read from the device (`file:`, `data:`, or an Android `content:` uri):

```ts
const form = new FormData()
form.append('title', 'Trip')
form.append('photo', { uri: photoUri, name: 'photo.jpg', type: 'image/jpeg' })

await fetch('https://api.example.com/photos', { method: 'POST', body: form })
```

Don't set `Content-Type` yourself: it carries the boundary between the parts.

### Cancelling

Pass an `AbortController`'s `signal`. Aborting rejects the request at once with an `AbortError`,
and cancels it natively:

```ts
const controller = new AbortController()
fetch(`https://api.example.com/search?q=${query}`, { signal: controller.signal })
  .then((response) => response.json())
  .then(showResults)
  .catch((error) => {
    if (error.name !== 'AbortError') throw error
  })

controller.abort() // a new query came in
```

Response bodies are text (JSON included): no `blob()`, `arrayBuffer()` or streaming. For those, use
`XMLHttpRequest`.

## XMLHttpRequest

The web's `XMLHttpRequest`, which `fetch` is built on, for what `fetch` doesn't do: upload and download
progress, binary responses, timeouts. Libraries that use it work as they do in a browser.

```ts
const xhr = new XMLHttpRequest()
xhr.upload.onprogress = ({ loaded, total }) => (progress.value = loaded / total)
xhr.onload = () => console.log(xhr.status, xhr.responseText)
xhr.open('POST', 'https://api.example.com/photos')
xhr.send(form)
```

- `responseType`: `''` or `'text'`, `'json'`, or `'arraybuffer'`; not `'blob'` or `'document'`.
- `onprogress` gets the text as it arrives: `responseText` grows while the response downloads.
- `timeout`, in milliseconds, fires `ontimeout`.
- Bodies: text, `FormData`, an `ArrayBuffer` or typed array, or `{ uri }` for a file on the device.
- Cookies are sent and kept on the device, across launches (`withCredentials` is `true` by default;
  `false`, or fetch's `credentials: 'omit'`, neither sends nor keeps them). They're the same cookies
  as the app's web views.
- Files are uploaded from disk as they're sent, so a large video never sits in memory.

`Event`, `ProgressEvent`, `EventTarget`, `AbortController` and `AbortSignal` (with `AbortSignal.timeout`)
are there too.

## Platform

```ts
Platform.OS // 'ios' | 'android'
Platform.select({ ios: 'Settings', android: 'Preferences' }) // the current platform's value
Platform.select({ ios: 17, default: 16 }) // `default` covers the others
```

## Appearance

The system's light or dark appearance:

```ts
import { Appearance, useColorScheme } from 'vue'

const colorScheme = useColorScheme() // a ref: 'light' | 'dark', follows the system live

Appearance.getColorScheme() // 'light' | 'dark', right now
const stop = Appearance.addChangeListener((colorScheme) => {
  // …
})
stop() // removes the listener
```

See [Styling](styling.md#dark-mode).

## Keyboard

```ts
Keyboard.dismiss() // closes the keyboard
```

To keep fields visible above the keyboard, see
[`ScrollView`](components/scroll-view.md#the-keyboard) and
[`KeyboardAvoidingView`](components/keyboard-avoiding-view.md).

## AccessibilityInfo

```ts
AccessibilityInfo.isScreenReaderEnabled() // VoiceOver or TalkBack is on
AccessibilityInfo.isReduceMotionEnabled()
AccessibilityInfo.announce('Saved')
```

See [Accessibility](accessibility.md).

## Dimensions

```ts
import { Dimensions, useWindowDimensions } from 'vue'

const { width, height } = Dimensions.get('window') // in points, right now
const window = useWindowDimensions() // a ref: follows rotation and split view
```

`Dimensions.get` reads the size once; use `useWindowDimensions()` in templates and `computed`s so
they update when the window is resized. For layouts, prefer flexbox and percentages.

## Timers

`setTimeout`, `clearTimeout`, `setInterval` and `clearInterval`, as on the web. No import needed.

## Logging

`console.log`, `console.info`, `console.warn` and `console.error` print to Xcode's console on iOS and
to Logcat on Android.

## Native functions

Packages with native code expose functions to JavaScript; see
[Writing a package with native code](packages.md#writing-a-package-with-native-code).

```ts
import { requireNativeFunction } from 'vue'

const isAvailable = requireNativeFunction<() => boolean>('camera.isAvailable')
```
