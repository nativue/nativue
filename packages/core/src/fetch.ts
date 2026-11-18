// fetch, Headers and Response, like the browser's: native runs the request with
// URLSession and calls back __fetchFinished.
// ponytail: text bodies only (no Blob, FormData or streaming) and no AbortController.
const native = globalThis.__native

interface PendingRequest {
  resolve: (response: FetchResponse) => void
  reject: (error: Error) => void
  url: string
}

const pendingRequestsById = new Map<number, PendingRequest>()
let nextRequestId = 1

type HeadersInit = FetchHeaders | Record<string, string>

export interface RequestInit {
  method?: string
  headers?: HeadersInit
  body?: string | null
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

  constructor(
    { status, headers, body }: { status: number; headers: Record<string, string>; body: string },
    url: string,
  ) {
    this.status = status
    this.ok = status >= 200 && status < 300
    this.headers = new FetchHeaders(headers)
    this.url = url
    this.body = body
  }

  async text(): Promise<string> {
    return this.body
  }

  // ponytail: `any` like the DOM's json(); type it at the call site.
  async json(): Promise<any> {
    return JSON.parse(this.body)
  }
}

function fetch(
  input: string | { toString(): string },
  { method = 'GET', headers = {}, body = null }: RequestInit = {},
): Promise<FetchResponse> {
  const url = String(input)

  return new Promise((resolve, reject) => {
    const requestId = nextRequestId++
    pendingRequestsById.set(requestId, { resolve, reject, url })

    const headerEntries = Object.fromEntries(new FetchHeaders(headers).valuesByName)
    native.fetch(
      requestId,
      url,
      method.toUpperCase(),
      headerEntries,
      body == null ? null : String(body),
    )
  })
}

globalThis.__fetchFinished = (requestId, response, errorMessage) => {
  const request = pendingRequestsById.get(requestId)
  if (!request) return

  const { resolve, reject, url } = request
  pendingRequestsById.delete(requestId)

  if (errorMessage || !response) reject(new TypeError(`Network request failed: ${errorMessage}`))
  else resolve(new FetchResponse(response, url))
}

Object.assign(globalThis, { fetch, Headers: FetchHeaders, Response: FetchResponse })

declare global {
  var fetch: (input: string | { toString(): string }, init?: RequestInit) => Promise<FetchResponse>
  var Headers: typeof FetchHeaders
  type Headers = FetchHeaders
  var Response: typeof FetchResponse
  type Response = FetchResponse
}
