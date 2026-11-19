// What the JavaScript engine has globally: the bridge, the hooks native calls into, and the web APIs
// prelude.ts (timers, console) and fetch.ts provide. No DOM.
import type { ColorScheme, WindowSize } from './appearance'
import type { LayoutEvent, NativeModule, NetworkEventPayloads } from './types'

declare global {
  var __native: NativeModule
  var __NATIVUE_HOT__: { clientId: string; serverURL: string } | undefined
  var __dispatch: (nodeId: number, eventName: string, payload: unknown) => void
  var __layoutsChanged: (layouts: ({ id: number } & LayoutEvent)[]) => void
  var __openURL: (url: string) => void
  var __fireTimer: (timerId: number) => void
  var __colorSchemeChanged: (colorScheme: ColorScheme) => void
  var __windowSizeChanged: (windowSize: WindowSize) => void
  var __asyncFunctionFinished: (callId: number, value: unknown, errorMessage: string | null) => void
  var __animationFinished: (animationId: number, finished: boolean) => void
  var __networkEvent: <Name extends keyof NetworkEventPayloads>(
    requestId: number,
    eventName: Name,
    payload: NetworkEventPayloads[Name],
  ) => void
  /** From the runtime (not __native): an object whose garbage collection releases the blob's bytes. */
  var __blobCollector: ((blobId: string) => object) | undefined

  var console: {
    log(...values: unknown[]): void
    info(...values: unknown[]): void
    warn(...values: unknown[]): void
    error(...values: unknown[]): void
  }

  function setTimeout<Args extends unknown[]>(
    callback: (...args: Args) => void,
    delay?: number,
    ...args: Args
  ): number
  function clearTimeout(timerId: number | undefined | null): void
  function setInterval<Args extends unknown[]>(
    callback: (...args: Args) => void,
    delay?: number,
    ...args: Args
  ): number
  function clearInterval(timerId: number | undefined | null): void
}

export {}
