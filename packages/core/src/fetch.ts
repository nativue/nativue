// fetch, Headers and Response, like the browser's, on top of XMLHttpRequest (./xhr). Also puts the
// networking classes the browser has globally (XMLHttpRequest, FormData, AbortController...) on globalThis.
// Limitation: Response bodies are text only (no blob() or arrayBuffer()) and there's no Request class.
import {
  AbortController,
  AbortSignal,
  Event,
  EventTarget,
  namedError,
  ProgressEvent,
} from './events'
import { FormData, XMLHttpRequest, type XMLHttpRequestBody } from './xhr'

type HeadersInit = FetchHeaders | Record<string, string>

export interface RequestInit {
  method?: string
  headers?: HeadersInit
  body?: XMLHttpRequestBody
  signal?: AbortSignal | null
  /** 'include' (the default here) or 'same-origin' send cookies; 'omit' doesn't. */
  credentials?: 'include' | 'same-origin' | 'omit'
}

class FetchHeaders {
  readonly valuesByName = new Map<string, string>()

  constructor(init: HeadersInit = {}) {
    const entries = init instanceof FetchHeaders ? init.valuesByName : Object.entries(init)

    for (const [name, value] of entries) this.set(name, value)
  }

  get(name: string): string | null {
    return this.valuesByName.get(name.toLowerCase()) ?? null
  }

  set(name: string, value: string): void {
    this.valuesByName.set(name.toLowerCase(), String(value))
  }

  has(name: string): boolean {
    return this.valuesByName.has(name.toLowerCase())
  }

  forEach(callback: (value: string, name: string, headers: FetchHeaders) => void): void {
    this.valuesByName.forEach((value, name) => callback(value, name, this))
  }
}

class FetchResponse {
  readonly status: number
  readonly ok: boolean
  readonly headers: FetchHeaders
  readonly url: string
  private readonly body: string

  constructor(xhr: XMLHttpRequest) {
    this.status = xhr.status
    this.ok = xhr.status >= 200 && xhr.status < 300
    this.headers = new FetchHeaders(parseHeaders(xhr.getAllResponseHeaders()))
    this.url = xhr.responseURL
    this.body = xhr.responseText
  }

  async text(): Promise<string> {
    return this.body
  }

  // Limitation: `any` like the DOM's json(); type it at the call site.
  async json(): Promise<any> {
    return JSON.parse(this.body)
  }
}

function parseHeaders(text: string): Record<string, string> {
  const lines = text.split('\r\n').filter(Boolean)

  return Object.fromEntries(lines.map((line) => line.split(/: (.*)/s).slice(0, 2)))
}

function fetch(
  input: string | { toString(): string },
  { method = 'GET', headers = {}, body = null, signal = null, credentials }: RequestInit = {},
): Promise<FetchResponse> {
  if (signal?.aborted) return Promise.reject(signal.reason)

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()

    xhr.open(method, input)
    xhr.withCredentials = credentials !== 'omit'
    new FetchHeaders(headers).forEach((value, name) => xhr.setRequestHeader(name, value))

    xhr.onload = () => resolve(new FetchResponse(xhr))
    xhr.onerror = () => reject(new TypeError('Network request failed'))
    xhr.ontimeout = () => reject(new TypeError('Network request timed out'))
    xhr.onabort = () => reject(signal?.reason ?? namedError('AbortError', 'Aborted'))
    xhr.onloadend = () => signal?.removeEventListener('abort', abort)
    signal?.addEventListener('abort', abort)

    xhr.send(body)
  })
}

Object.assign(globalThis, {
  fetch,
  Headers: FetchHeaders,
  Response: FetchResponse,
  XMLHttpRequest,
  FormData,
  AbortController,
  AbortSignal,
  Event,
  EventTarget,
  ProgressEvent,
})

declare global {
  var fetch: (input: string | { toString(): string }, init?: RequestInit) => Promise<FetchResponse>
  var Headers: typeof FetchHeaders
  type Headers = FetchHeaders
  var Response: typeof FetchResponse
  type Response = FetchResponse
  var XMLHttpRequest: typeof import('./xhr').XMLHttpRequest
  type XMLHttpRequest = import('./xhr').XMLHttpRequest
  var FormData: typeof import('./xhr').FormData
  type FormData = import('./xhr').FormData
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
}
