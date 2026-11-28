import { defineComponent, h, requireNativeFunction, type PropType } from '@nativue/core'

export type WebViewSource =
  /** A page to load, with headers for that first request only. */
  | { uri: string; headers?: Record<string, string> }
  /** HTML to show; its relative links and scripts load from baseUrl. */
  | { html: string; baseUrl?: string }

export interface WebViewNavigation {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export interface WebViewError {
  url: string
  /** The platform's own code: an NSURLErrorDomain code on iOS, a WebViewClient.ERROR_* on Android. */
  code: number
  description: string
}

export interface WebViewMessage {
  /** What the page passed to window.nativueWebView.postMessage, as a string. */
  data: string
}

/** The methods a ref to <WebView> has. */
export interface WebViewMethods {
  goBack(): Promise<void>
  goForward(): Promise<void>
  reload(): Promise<void>
  stopLoading(): Promise<void>
  /**
   * Evaluates expression in the page and resolves its value, as JSON makes it (an object, an array, a
   * string...; undefined for what JSON drops). Statements go in a function: `(() => { ...; return x })()`.
   * Rejects with the page's error when it throws.
   */
  evaluateJavaScript<Value = unknown>(expression: string): Promise<Value>
  /** Dispatches a `message` event on the page's window, whose `data` is this string. */
  postMessage(data: string): Promise<void>
}

type NativeCommand = (webViewId: number) => Promise<void>

const nativeGoBack = requireNativeFunction<NativeCommand>('webView.goBack')
const nativeGoForward = requireNativeFunction<NativeCommand>('webView.goForward')
const nativeReload = requireNativeFunction<NativeCommand>('webView.reload')
const nativeStopLoading = requireNativeFunction<NativeCommand>('webView.stopLoading')
const nativeEvaluate =
  requireNativeFunction<(webViewId: number, script: string) => Promise<string | null>>(
    'webView.evaluate',
  )

let lastWebViewId = 0

export const WebView = defineComponent({
  name: 'WebView',
  inheritAttrs: false,
  props: {
    source: { type: Object as PropType<WebViewSource>, required: true },
    /** Runs in the page once it has loaded, on every page it opens. */
    injectedJavaScript: String,
    /**
     * Runs before the page's own scripts, on every page it opens. Android also runs it in the page's
     * frames: check `window === window.top` when it's only for the page.
     */
    injectedJavaScriptBeforeContentLoaded: String,
    javaScriptEnabled: { type: Boolean, default: true },
    userAgent: String,
    /** iOS: swipe from the edge to go back and forward. */
    allowsBackForwardNavigationGestures: Boolean,
  },
  emits: {
    loadStart: (_navigation: { url: string }) => true,
    load: (_navigation: { url: string; title: string }) => true,
    error: (_error: WebViewError) => true,
    /** The server answered with a status of 400 or more; the page it sent still shows. */
    httpError: (_error: { url: string; statusCode: number }) => true,
    navigationStateChange: (_navigation: WebViewNavigation) => true,
    message: (_message: WebViewMessage) => true,
    /**
     * The page's process ended (the system needed the memory, or it crashed), leaving the view blank.
     * Render it again with a new `key` to load the page again; on iOS, reload() also does.
     */
    processTerminated: () => true,
  },
  setup(props, { attrs, emit, expose }) {
    const webViewId = ++lastWebViewId
    // Native finds the view by its id once the view is made: a method called sooner waits for it.
    let markRegistered = () => {}
    const registered = new Promise<void>((resolve) => (markRegistered = resolve))
    const command = (send: NativeCommand) => async () => {
      await registered

      return send(webViewId)
    }

    const methods: WebViewMethods = {
      goBack: command(nativeGoBack),

      goForward: command(nativeGoForward),

      reload: command(nativeReload),

      stopLoading: command(nativeStopLoading),

      async evaluateJavaScript(expression) {
        await registered

        return evaluate(webViewId, expression)
      },

      async postMessage(data) {
        await methods.evaluateJavaScript(
          `window.dispatchEvent(new MessageEvent('message', { data: ${JSON.stringify(String(data))} })), undefined`,
        )
      },
    }

    expose(methods)

    // Declared events leave attrs: native reports them here, and they go on to the listeners.
    const eventForwarders = {
      onRegistered: () => markRegistered(),

      onLoadStart: (navigation: { url: string }) => emit('loadStart', navigation),

      onLoad: (navigation: { url: string; title: string }) => emit('load', navigation),

      onError: (error: WebViewError) => emit('error', error),

      onHttpError: (error: { url: string; statusCode: number }) => emit('httpError', error),

      onNavigationStateChange: (navigation: WebViewNavigation) =>
        emit('navigationStateChange', navigation),

      onMessage: (message: WebViewMessage) => emit('message', message),

      onProcessTerminated: () => emit('processTerminated'),
    }

    return () => {
      const { source, ...options } = props

      return h('WebView', {
        ...attrs,
        ...options,
        ...eventForwarders,
        webViewId,
        url: 'uri' in source ? source.uri : null,
        headers: 'uri' in source ? (source.headers ?? null) : null,
        html: 'html' in source ? source.html : null,
        baseUrl: 'html' in source ? (source.baseUrl ?? null) : null,
      })
    }
  },
})

/**
 * The page answers with a JSON string either way, so iOS and Android give the same values, and a
 * thrown error comes back instead of the page's console.
 */
async function evaluate<Value>(webViewId: number, expression: string): Promise<Value> {
  const script = `(() => {
    try {
      return JSON.stringify({ value: (${expression}) })
    } catch (error) {
      return JSON.stringify({ error: String(error) })
    }
  })()`
  const answer = await nativeEvaluate(webViewId, script)
  const { value, error } = answer ? JSON.parse(answer) : ({} as { value?: Value; error?: string })

  if (error !== undefined) throw new Error(`WebView.evaluateJavaScript: ${error}`)

  return value
}
