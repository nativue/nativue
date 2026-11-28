# @nativue/webview

Web pages inside [nativue](https://github.com/nativue/nativue) apps, with messages both ways:
WKWebView on iOS, the system WebView on Android.

```sh
npm install @nativue/webview
```

Then rebuild the app (`npm run ios`, `npm run android`): its native code is linked when the app is
built.

```vue
<script setup lang="ts">
import { useTemplateRef } from 'vue'
import { WebView, type WebViewMethods } from '@nativue/webview'

const webView = useTemplateRef<WebViewMethods>('webView')
</script>

<template>
  <WebView
    ref="webView"
    :style="{ flex: 1 }"
    :source="{ uri: 'https://vuejs.org' }"
    @message="({ data }) => console.info(data)"
  />
  <Button title="Back" @press="webView?.goBack()" />
</template>
```

Like other native views, it's sized by its style (`flex: 1`, a `height`), not by the page.

## Props

| Prop                                    |                                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| `source`                                | `{ uri, headers? }`, a page (the headers go with its first request), or `{ html, baseUrl? }` |
| `injectedJavaScript`                    | runs once each page has loaded                                                               |
| `injectedJavaScriptBeforeContentLoaded` | runs before each page's own scripts                                                          |
| `javaScriptEnabled`                     | `true` by default                                                                            |
| `userAgent`                             | replaces the browser's                                                                       |
| `allowsBackForwardNavigationGestures`   | iOS: swipe from the edge to go back and forward                                              |

Links to other schemes (`tel:`, `mailto:`, another app's) open in the app they belong to.
`target="_blank"` links and `window.open` load in the same view.

## Events

| Event                      | Payload                                                                       |
| -------------------------- | ----------------------------------------------------------------------------- |
| `@load-start`              | `{ url }`                                                                     |
| `@load`                    | `{ url, title }`                                                              |
| `@error`                   | `{ url, code, description }`: the page couldn't load (offline, no such host)  |
| `@http-error`              | `{ url, statusCode }`: a status of 400 or more; the server's page still shows |
| `@navigation-state-change` | `{ url, title, loading, canGoBack, canGoForward }`                            |
| `@message`                 | `{ data }`: what the page posted                                              |

## Messages

The page posts a string to the app; send objects as JSON:

```js
window.nativueWebView.postMessage(JSON.stringify({ type: 'paid', orderId: 42 }))
```

The app posts to the page, which gets a `message` event on its window:

```ts
await webView.value?.postMessage(JSON.stringify({ type: 'theme', dark: true }))
```

```js
window.addEventListener('message', (event) => apply(JSON.parse(event.data)))
```

Any page the view loads can post, its frames too: check what a message says before acting on it.

## Methods

A ref to `<WebView>` (typed `WebViewMethods`) has:

| Method                           |                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| `goBack()`, `goForward()`        | in the view's history                                                                       |
| `reload()`, `stopLoading()`      |                                                                                             |
| `evaluateJavaScript(expression)` | resolves the expression's value, through JSON; rejects with the page's error when it throws |
| `postMessage(data)`              | a `message` event on the page's window                                                      |

`evaluateJavaScript` takes an expression: `document.title`, or `(() => { ...; return value })()`
for statements. Promises aren't awaited.

They reject with `ERR_UNAVAILABLE` once the view is gone.

## Permissions

None. Android's `INTERNET` permission comes with nativue.

## Not yet

File inputs (`<input type="file">`), the page's camera, microphone and location, `alert()` and
`confirm()` dialogs, downloads, and deciding in JavaScript whether a link loads.
