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

Request and response bodies are text (JSON included): no `Blob`, `FormData`, streaming or
`AbortController`.

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

## Dimensions

```ts
const { width, height } = Dimensions.get('window') // in points
```

The size when the app started: it doesn't update on rotation. For layouts, prefer flexbox and
percentages.

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
