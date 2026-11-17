// fetch, Headers and Response, like the browser's and React Native's: native runs the request with
// URLSession and calls back __fetchFinished.
// ponytail: text bodies only (no Blob, FormData or streaming) and no AbortController.
const native = globalThis.__native
const pendingRequestsById = new Map()
let nextRequestId = 1

class Headers {
  constructor(init = {}) {
    const entries = init instanceof Headers ? init.valuesByName : Object.entries(init)
    this.valuesByName = new Map()

    for (const [name, value] of entries) this.set(name, value)
  }

  get(name) {
    return this.valuesByName.get(name.toLowerCase()) ?? null
  }

  set(name, value) {
    this.valuesByName.set(name.toLowerCase(), String(value))
  }

  has(name) {
    return this.valuesByName.has(name.toLowerCase())
  }

  forEach(callback) {
    this.valuesByName.forEach((value, name) => callback(value, name, this))
  }
}

class Response {
  constructor({ status, headers, body }, url) {
    this.status = status
    this.ok = status >= 200 && status < 300
    this.headers = new Headers(headers)
    this.url = url
    this.body = body
  }

  async text() {
    return this.body
  }

  async json() {
    return JSON.parse(this.body)
  }
}

function fetch(input, { method = 'GET', headers = {}, body = null } = {}) {
  const url = String(input)

  return new Promise((resolve, reject) => {
    const requestId = nextRequestId++
    pendingRequestsById.set(requestId, { resolve, reject, url })

    const headerEntries = Object.fromEntries(new Headers(headers).valuesByName)
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
  const { resolve, reject, url } = pendingRequestsById.get(requestId)
  pendingRequestsById.delete(requestId)

  if (errorMessage) reject(new TypeError(`Network request failed: ${errorMessage}`))
  else resolve(new Response(response, url))
}

Object.assign(globalThis, { fetch, Headers, Response })
