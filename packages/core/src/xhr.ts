// XMLHttpRequest and FormData, like the browser's: native runs the request, and its progress comes back as
// events through __networkEvent. fetch and libraries like axios build on it.
import { fromByteArray, toByteArray } from 'base64-js'
import { Event, EventTarget, ProgressEvent } from './events'
import type { NativeFormDataPart, NativeRequestBody, NetworkEventPayloads } from './types'

const native = globalThis.__native

const UNSENT = 0
const OPENED = 1
const HEADERS_RECEIVED = 2
const LOADING = 3
const DONE = 4

// 'blob' and 'document' aren't supported.
export type XMLHttpRequestResponseType = '' | 'text' | 'json' | 'arraybuffer'

const SUPPORTED_RESPONSE_TYPES = new Set(['', 'text', 'json', 'arraybuffer'])

type EventHandler<EventType = Event> = ((event: EventType) => void) | null

/** A file to upload: where it is on the device, and the name and type the server gets. */
export interface FormDataFile {
  uri: string
  name?: string
  type?: string
}

type FormDataValue = string | FormDataFile

export class FormData {
  private readonly entries: [string, FormDataValue][] = []

  append(name: string, value: FormDataValue | number | boolean): void {
    this.entries.push([name, typeof value === 'object' ? value : String(value)])
  }

  set(name: string, value: FormDataValue | number | boolean): void {
    this.delete(name)
    this.append(name, value)
  }

  get(name: string): FormDataValue | null {
    return this.entries.find(([entryName]) => entryName === name)?.[1] ?? null
  }

  getAll(name: string): FormDataValue[] {
    return this.entries.filter(([entryName]) => entryName === name).map(([, value]) => value)
  }

  has(name: string): boolean {
    return this.entries.some(([entryName]) => entryName === name)
  }

  delete(name: string): void {
    const remaining = this.entries.filter(([entryName]) => entryName !== name)

    this.entries.splice(0, this.entries.length, ...remaining)
  }

  forEach(callback: (value: FormDataValue, name: string, formData: FormData) => void): void {
    this.entries.forEach(([name, value]) => callback(value, name, this))
  }

  /** What native turns into a multipart/form-data body. */
  toNativeParts(): NativeFormDataPart[] {
    return this.entries.map(([name, value]) => {
      if (typeof value === 'string') return { name, value }

      const filename = value.name ?? 'file'
      const type = value.type ?? 'application/octet-stream'

      return { name, uri: value.uri, filename, type }
    })
  }
}

export type XMLHttpRequestBody =
  string | FormData | ArrayBuffer | ArrayBufferView | { uri: string } | null | undefined

function nativeBody(body: XMLHttpRequestBody): NativeRequestBody {
  if (body == null) return null
  if (typeof body === 'string') return { string: body }
  if (body instanceof FormData) return { formData: body.toNativeParts() }
  if (body instanceof ArrayBuffer) return { base64: fromByteArray(new Uint8Array(body)) }
  if (ArrayBuffer.isView(body)) {
    return { base64: fromByteArray(new Uint8Array(body.buffer, body.byteOffset, body.byteLength)) }
  }
  if ('uri' in body) return { uri: body.uri }

  return { string: String(body) }
}

let nextRequestId = 1
const requestsById = new Map<number, XMLHttpRequest>()

/** Where upload progress goes: `xhr.upload.onprogress`. */
export class XMLHttpRequestUpload extends EventTarget {
  onloadstart: EventHandler<ProgressEvent> = null
  onprogress: EventHandler<ProgressEvent> = null
  onload: EventHandler<ProgressEvent> = null
  onloadend: EventHandler<ProgressEvent> = null
  onerror: EventHandler<ProgressEvent> = null
  onabort: EventHandler<ProgressEvent> = null
  ontimeout: EventHandler<ProgressEvent> = null
}

export class XMLHttpRequest extends EventTarget {
  static readonly UNSENT = UNSENT
  static readonly OPENED = OPENED
  static readonly HEADERS_RECEIVED = HEADERS_RECEIVED
  static readonly LOADING = LOADING
  static readonly DONE = DONE
  readonly UNSENT = UNSENT
  readonly OPENED = OPENED
  readonly HEADERS_RECEIVED = HEADERS_RECEIVED
  readonly LOADING = LOADING
  readonly DONE = DONE

  readyState = UNSENT
  status = 0
  statusText = ''
  responseURL = ''
  /** In milliseconds; 0 waits for as long as the platform does. */
  timeout = 0
  /** Sends and stores cookies. */
  withCredentials = true
  readonly upload = new XMLHttpRequestUpload()

  onreadystatechange: EventHandler = null
  onloadstart: EventHandler<ProgressEvent> = null
  onprogress: EventHandler<ProgressEvent> = null
  onload: EventHandler<ProgressEvent> = null
  onloadend: EventHandler<ProgressEvent> = null
  onerror: EventHandler<ProgressEvent> = null
  onabort: EventHandler<ProgressEvent> = null
  ontimeout: EventHandler<ProgressEvent> = null

  private method = 'GET'
  private url = ''
  private requestHeaders: Record<string, string> = {}
  private responseHeaders: Record<string, string> = {}
  private chosenResponseType: XMLHttpRequestResponseType = ''
  /** Text, or base64 for 'arraybuffer'. */
  private rawResponse = ''
  private parsedResponse: unknown = undefined
  private requestId: number | null = null
  private sent = false
  private aborted = false
  private failed = false
  private timedOut = false

  get responseType(): XMLHttpRequestResponseType {
    return this.chosenResponseType
  }

  set responseType(responseType: XMLHttpRequestResponseType) {
    if (this.sent) throw new Error("responseType can't change once the request is sent")
    if (!SUPPORTED_RESPONSE_TYPES.has(responseType)) {
      console.warn(`XMLHttpRequest: responseType '${responseType}' is not supported`)
      return
    }

    this.chosenResponseType = responseType
  }

  get responseText(): string {
    if (!this.returnsText()) {
      throw new Error(`responseText is only available when responseType is '' or 'text'`)
    }

    return this.readyState < LOADING ? '' : this.rawResponse
  }

  get response(): unknown {
    if (this.returnsText()) return this.readyState < LOADING || this.failed ? '' : this.rawResponse
    if (this.readyState !== DONE || this.failed) return null

    this.parsedResponse ??= this.parseResponse()

    return this.parsedResponse
  }

  open(method: string, url: string | { toString(): string }, async = true): void {
    if (!async) throw new Error('Synchronous requests are not supported')

    this.resetResponse()
    this.method = method.toUpperCase()
    this.url = String(url)
    this.requestHeaders = {}
    this.sent = false
    this.aborted = false
    this.setReadyState(OPENED)
  }

  setRequestHeader(name: string, value: string): void {
    if (this.readyState !== OPENED || this.sent)
      throw new Error('The request must be opened, not sent')

    const key = name.toLowerCase()
    const existing = this.requestHeaders[key]
    this.requestHeaders[key] = existing === undefined ? String(value) : `${existing}, ${value}`
  }

  getResponseHeader(name: string): string | null {
    return this.responseHeaders[name.toLowerCase()] ?? null
  }

  getAllResponseHeaders(): string {
    const names = Object.keys(this.responseHeaders).sort()

    return names.map((name) => `${name}: ${this.responseHeaders[name]}\r\n`).join('')
  }

  // Charsets and MIME sniffing are native's: the response arrives already decoded.
  overrideMimeType(): void {}

  send(body: XMLHttpRequestBody = null): void {
    if (this.readyState !== OPENED || this.sent)
      throw new Error('The request must be opened, not sent')

    this.sent = true
    const requestId = nextRequestId++
    this.requestId = requestId
    requestsById.set(requestId, this)

    this.dispatchProgress(this, 'loadstart', 0, 0)
    native.sendRequest(requestId, {
      method: this.method,
      url: this.url,
      headers: this.requestHeaders,
      body: nativeBody(body),
      responseType: this.chosenResponseType === 'arraybuffer' ? 'base64' : 'text',
      incrementalUpdates: this.wantsIncrementalUpdates(),
      timeout: this.timeout,
      withCredentials: this.withCredentials,
    })
  }

  abort(): void {
    this.aborted = true
    if (this.requestId !== null) {
      native.abortRequest(this.requestId)
      this.forgetRequest()
    }

    const inFlight = this.sent && this.readyState !== DONE
    if (inFlight) {
      this.resetResponse()
      this.setReadyState(DONE)
    }
    this.readyState = UNSENT
  }

  /** From native, through __networkEvent. */
  handleNetworkEvent<Name extends keyof NetworkEventPayloads>(
    eventName: Name,
    payload: NetworkEventPayloads[Name],
  ): void {
    const handlers: { [EventName in keyof NetworkEventPayloads]: (payload: any) => void } = {
      uploadprogress: ({ loaded, total }) =>
        this.dispatchProgress(this.upload, 'progress', loaded, total),
      response: ({ status, headers, url }) => this.receiveResponse(status, headers, url),
      data: ({ data }) => this.receiveData(data),
      incrementaldata: ({ text, loaded, total }) =>
        this.receiveIncrementalData(text, loaded, total),
      progress: ({ loaded, total }) => this.dispatchProgress(this, 'progress', loaded, total),
      complete: ({ error, timedOut }) => this.complete(error, timedOut),
    }

    handlers[eventName](payload)
  }

  private receiveResponse(status: number, headers: Record<string, string>, url: string) {
    this.status = status
    this.responseURL = url
    this.responseHeaders = Object.fromEntries(
      Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value)]),
    )
    this.setReadyState(HEADERS_RECEIVED)
  }

  private receiveData(data: string) {
    this.rawResponse = data
    this.parsedResponse = undefined
    this.setReadyState(LOADING)
  }

  private receiveIncrementalData(text: string, loaded: number, total: number) {
    this.rawResponse += text
    this.setReadyState(LOADING)
    this.dispatchProgress(this, 'progress', loaded, total)
  }

  private complete(error: string | null, timedOut: boolean) {
    this.forgetRequest()
    if (error) {
      this.failed = true
      this.timedOut = timedOut
      if (this.returnsText()) this.rawResponse = ''
    }

    this.setReadyState(DONE)
  }

  // Readystatechange on every change; once DONE, the event that tells how it ended, then loadend.
  private setReadyState(readyState: number) {
    this.readyState = readyState
    this.dispatchEvent(new Event('readystatechange'))
    if (readyState !== DONE) return

    const outcome = this.aborted
      ? 'abort'
      : this.timedOut
        ? 'timeout'
        : this.failed
          ? 'error'
          : 'load'
    const length = this.rawResponse.length
    this.dispatchProgress(this, outcome, length, length)
    this.dispatchProgress(this, 'loadend', length, length)
  }

  private dispatchProgress(target: EventTarget, type: string, loaded: number, total: number) {
    target.dispatchEvent(new ProgressEvent(type, { lengthComputable: total > 0, loaded, total }))
  }

  // Sending every chunk of a large download to JS costs: only when someone watches the progress.
  private wantsIncrementalUpdates(): boolean {
    return (
      this.onprogress !== null ||
      this.onreadystatechange !== null ||
      this.hasListeners('progress') ||
      this.hasListeners('readystatechange')
    )
  }

  private returnsText(): boolean {
    return this.chosenResponseType === '' || this.chosenResponseType === 'text'
  }

  private parseResponse(): unknown {
    if (this.chosenResponseType === 'arraybuffer') return toByteArray(this.rawResponse).buffer

    try {
      return JSON.parse(this.rawResponse)
    } catch {
      return null
    }
  }

  private resetResponse() {
    this.status = 0
    this.statusText = ''
    this.responseURL = ''
    this.responseHeaders = {}
    this.rawResponse = ''
    this.parsedResponse = undefined
    this.failed = false
    this.timedOut = false
  }

  private forgetRequest() {
    if (this.requestId !== null) requestsById.delete(this.requestId)
    this.requestId = null
  }
}

globalThis.__networkEvent = (requestId, eventName, payload) => {
  requestsById.get(requestId)?.handleNetworkEvent(eventName, payload as never)
}
