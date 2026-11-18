// fetch, Headers, Request and Response: whatwg-fetch (the browser polyfill) on top of XMLHttpRequest,
// with responses kept as native Blobs. ./networking goes first: it puts what whatwg-fetch looks for on
// globalThis.
import './networking'
import 'whatwg-fetch'

type HeadersInit = Headers | Record<string, string> | [string, string][]
type BodyInit = import('./xhr').XMLHttpRequestBody

interface RequestInit {
  method?: string
  headers?: HeadersInit
  body?: BodyInit
  signal?: AbortSignal | null
  /** 'same-origin' (the default) and 'include' send cookies; 'omit' doesn't. */
  credentials?: 'include' | 'same-origin' | 'omit'
}

interface ResponseInit {
  status?: number
  statusText?: string
  headers?: HeadersInit
  url?: string
}

interface Body {
  readonly bodyUsed: boolean
  text(): Promise<string>
  // `any` like the DOM's: type it at the call site.
  json(): Promise<any>
  blob(): Promise<Blob>
  arrayBuffer(): Promise<ArrayBuffer>
  formData(): Promise<FormData>
}

declare global {
  interface Headers {
    append(name: string, value: string): void
    delete(name: string): void
    get(name: string): string | null
    has(name: string): boolean
    set(name: string, value: string): void
    forEach(callback: (value: string, name: string, headers: Headers) => void): void
    keys(): IterableIterator<string>
    values(): IterableIterator<string>
    entries(): IterableIterator<[string, string]>
    [Symbol.iterator](): IterableIterator<[string, string]>
  }
  var Headers: { new (init?: HeadersInit): Headers; prototype: Headers }

  interface Request extends Body {
    readonly url: string
    readonly method: string
    readonly headers: Headers
    readonly credentials: 'include' | 'same-origin' | 'omit'
    readonly signal: AbortSignal
    clone(): Request
  }
  var Request: { new (input: string | Request, init?: RequestInit): Request; prototype: Request }

  interface Response extends Body {
    readonly status: number
    readonly statusText: string
    readonly ok: boolean
    readonly headers: Headers
    readonly url: string
    clone(): Response
  }
  var Response: {
    new (body?: BodyInit, init?: ResponseInit): Response
    prototype: Response
    error(): Response
    redirect(url: string, status?: number): Response
  }

  function fetch(
    input: string | { toString(): string } | Request,
    init?: RequestInit,
  ): Promise<Response>

  var XMLHttpRequest: typeof import('./xhr').XMLHttpRequest
  type XMLHttpRequest = import('./xhr').XMLHttpRequest
  var FormData: typeof import('./xhr').FormData
  type FormData = import('./xhr').FormData
  var Blob: typeof import('./blob').Blob
  type Blob = import('./blob').Blob
  var File: typeof import('./blob').File
  type File = import('./blob').File
  var FileReader: typeof import('./blob').FileReader
  type FileReader = import('./blob').FileReader
  var AbortController: typeof import('./events').AbortController
  type AbortController = import('./events').AbortController
  var AbortSignal: typeof import('./events').AbortSignal
  type AbortSignal = import('./events').AbortSignal
  var Event: typeof import('./events').Event
  type Event = import('./events').Event
  var EventTarget: typeof import('./events').EventTarget
  type EventTarget = import('./events').EventTarget
  var ProgressEvent: typeof import('./events').ProgressEvent
  type ProgressEvent = import('./events').ProgressEvent
  var URL: typeof import('./url').URL
  type URL = import('./url').URL
  var URLSearchParams: typeof import('./url').URLSearchParams
  type URLSearchParams = import('./url').URLSearchParams
  type RequestInit = import('./fetch').RequestInit
}

export type { RequestInit }
