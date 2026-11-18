// URL and URLSearchParams, like the browser's: Hermes has neither. Also URL.createObjectURL, for showing
// a Blob in <Image>.
// Limitation: parses URLs without the full WHATWG algorithm: no IDN (punycode) hosts, no percent-encoding
// or IPv6 normalization. Enough for building and reading http(s) URLs; use a full parser if that falls short.
import type { Blob } from './blob'

type SearchParamsInit = string | URLSearchParams | Record<string, string> | [string, string][]

export class URLSearchParams {
  private readonly pairs: [string, string][] = []
  /** Set by a URL, whose `search` follows its searchParams. */
  onChange: (() => void) | null = null

  constructor(init: SearchParamsInit = '') {
    if (typeof init === 'string') this.replaceWith(init)
    else if (init instanceof URLSearchParams) this.pairs.push(...init.pairs)
    else if (Array.isArray(init))
      init.forEach(([name, value]) => this.pairs.push([name, String(value)]))
    else Object.entries(init).forEach(([name, value]) => this.pairs.push([name, String(value)]))
  }

  get size(): number {
    return this.pairs.length
  }

  append(name: string, value: string): void {
    this.pairs.push([name, String(value)])
    this.onChange?.()
  }

  delete(name: string): void {
    this.splice(this.pairs.filter(([pairName]) => pairName !== name))
  }

  get(name: string): string | null {
    return this.pairs.find(([pairName]) => pairName === name)?.[1] ?? null
  }

  getAll(name: string): string[] {
    return this.pairs.filter(([pairName]) => pairName === name).map(([, value]) => value)
  }

  has(name: string): boolean {
    return this.pairs.some(([pairName]) => pairName === name)
  }

  // Replaces the first pair with that name and drops the others, keeping its place.
  set(name: string, value: string): void {
    const index = this.pairs.findIndex(([pairName]) => pairName === name)
    if (index === -1) return this.append(name, value)

    const others = this.pairs.filter(
      ([pairName], pairIndex) => pairName !== name || pairIndex === index,
    )
    this.splice(others.map((pair) => (pair[0] === name ? [name, String(value)] : pair)))
  }

  sort(): void {
    this.splice(
      [...this.pairs].sort(([first], [second]) => (first < second ? -1 : first > second ? 1 : 0)),
    )
  }

  forEach(callback: (value: string, name: string, searchParams: URLSearchParams) => void): void {
    this.pairs.forEach(([name, value]) => callback(value, name, this))
  }

  keys(): IterableIterator<string> {
    return this.pairs.map(([name]) => name)[Symbol.iterator]()
  }

  values(): IterableIterator<string> {
    return this.pairs.map(([, value]) => value)[Symbol.iterator]()
  }

  entries(): IterableIterator<[string, string]> {
    return this.pairs.map(([name, value]): [string, string] => [name, value])[Symbol.iterator]()
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.entries()
  }

  toString(): string {
    return this.pairs
      .map(([name, value]) => `${encodeFormComponent(name)}=${encodeFormComponent(value)}`)
      .join('&')
  }

  /** From a query string, without telling a URL: it's the one setting it. */
  replaceWith(query: string): void {
    const pairs = query
      .replace(/^\?/, '')
      .split('&')
      .filter(Boolean)
      .map((pair): [string, string] => {
        const separator = pair.indexOf('=')
        const name = separator === -1 ? pair : pair.slice(0, separator)
        const value = separator === -1 ? '' : pair.slice(separator + 1)

        return [decodeFormComponent(name), decodeFormComponent(value)]
      })

    this.pairs.splice(0, this.pairs.length, ...pairs)
  }

  private splice(pairs: [string, string][]) {
    this.pairs.splice(0, this.pairs.length, ...pairs)
    this.onChange?.()
  }
}

// application/x-www-form-urlencoded: encodeURIComponent leaves !'()~ as they are, and a space is '+'.
function encodeFormComponent(text: string): string {
  return encodeURIComponent(text)
    .replace(/[!'()~]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+')
}

function decodeFormComponent(text: string): string {
  const spaced = text.replace(/\+/g, ' ')

  try {
    return decodeURIComponent(spaced)
  } catch {
    return spaced
  }
}

// scheme:, then //user:password@host:port (optional), path, ?query, #fragment.
const URL_PATTERN =
  /^([a-z][a-z\d+.-]*:)(?:\/\/(?:([^:@/?#]*)(?::([^@/?#]*))?@)?(\[[^\]]*\]|[^:/?#]*)(?::(\d*))?)?([^?#]*)(\?[^#]*)?(#.*)?$/i

const DEFAULT_PORTS: Record<string, string> = {
  'http:': '80',
  'https:': '443',
  'ws:': '80',
  'wss:': '443',
}

/** Blobs shown through an object URL, kept alive until it's revoked. */
const blobsByObjectUrl = new Map<string, Blob>()

export class URL {
  protocol = ''
  username = ''
  password = ''
  hostname = ''
  port = ''
  pathname = ''
  hash = ''
  private hasAuthority = false
  private query = ''
  private params: URLSearchParams | null = null

  constructor(url: string | URL, base?: string | URL) {
    this.href = base === undefined ? String(url) : resolve(String(url), new URL(base))
  }

  /** `blob:` URL for a Blob, which <Image> can show. The Blob stays alive until revokeObjectURL. */
  static createObjectURL(blob: Blob): string {
    const { blobId, offset, size } = blob.data
    const url = `blob:${blobId}?offset=${offset}&size=${size}`
    blobsByObjectUrl.set(url, blob)

    return url
  }

  static revokeObjectURL(url: string): void {
    blobsByObjectUrl.delete(url)
  }

  static canParse(url: string, base?: string): boolean {
    try {
      new URL(url, base)
      return true
    } catch {
      return false
    }
  }

  get href(): string {
    const credentials = this.username
      ? `${this.username}${this.password ? `:${this.password}` : ''}@`
      : ''
    const authority = this.hasAuthority ? `//${credentials}${this.host}` : ''

    return `${this.protocol}${authority}${this.pathname}${this.search}${this.hash}`
  }

  set href(url: string) {
    const match = URL_PATTERN.exec(url.trim())
    if (!match) throw new TypeError(`Invalid URL: ${url}`)

    const [, protocol, username, password, hostname, port, pathname, query, hash] = match
    this.protocol = protocol.toLowerCase()
    this.hasAuthority = hostname !== undefined
    this.username = username ?? ''
    this.password = password ?? ''
    this.hostname = (hostname ?? '').toLowerCase()
    this.port = port === DEFAULT_PORTS[this.protocol] ? '' : (port ?? '')
    this.pathname = this.hasAuthority ? removeDotSegments(pathname) || '/' : pathname
    this.search = query ?? ''
    this.hash = hash === '#' ? '' : (hash ?? '')
  }

  get host(): string {
    return this.port ? `${this.hostname}:${this.port}` : this.hostname
  }

  set host(host: string) {
    const [hostname, port = ''] = host.split(':')
    this.hostname = hostname.toLowerCase()
    this.port = port
  }

  get origin(): string {
    return this.hasAuthority ? `${this.protocol}//${this.host}` : 'null'
  }

  get search(): string {
    return this.query.length > 1 ? this.query : ''
  }

  set search(search: string) {
    this.query = search && !search.startsWith('?') ? `?${search}` : search
    this.params?.replaceWith(this.query)
  }

  get searchParams(): URLSearchParams {
    if (this.params) return this.params

    this.params = new URLSearchParams(this.query)
    this.params.onChange = () => {
      const query = this.params!.toString()
      this.query = query ? `?${query}` : ''
    }

    return this.params
  }

  toString(): string {
    return this.href
  }

  toJSON(): string {
    return this.href
  }
}

/** `url` relative to `base`, as a browser resolves a link. */
function resolve(url: string, base: URL): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(url)) return url
  if (url.startsWith('//')) return `${base.protocol}${url}`

  const root = `${base.protocol}${base.origin === 'null' ? '' : `//${base.host}`}`
  if (url.startsWith('/')) return `${root}${url}`
  if (url.startsWith('?')) return `${root}${base.pathname}${url}`
  if (url.startsWith('#')) return `${root}${base.pathname}${base.search}${url}`
  if (url === '') return `${root}${base.pathname}${base.search}`

  const directory = base.pathname.slice(0, base.pathname.lastIndexOf('/') + 1)

  return `${root}${directory}${url}`
}

// "/a/b/../c/./d" → "/a/c/d"
function removeDotSegments(path: string): string {
  const segments: string[] = []

  for (const segment of path.split('/')) {
    if (segment === '..') {
      if (segments.length > 1) segments.pop()
    } else if (segment !== '.') {
      segments.push(segment)
    }
  }

  const endsInDirectory = /\/\.{1,2}$/.test(path)

  return segments.join('/') + (endsInDirectory ? '/' : '')
}
