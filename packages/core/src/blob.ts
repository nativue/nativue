// Blob, File and FileReader, like the browser's. The bytes stay native (see BlobStore), so a large
// download never crosses into JS unless it's read. They're freed when the garbage collector collects
// the last Blob that points to them: __blobCollector gives an object whose collection frees them.
import { fromByteArray, toByteArray } from 'base64-js'
import { EventTarget, ProgressEvent } from './events'
import type { NativeBlob, NativeBlobPart } from './types'

const native = globalThis.__native

export type BlobPart = string | ArrayBuffer | ArrayBufferView | Blob

export interface BlobPropertyBag {
  type?: string
}

export class Blob {
  /** Where the bytes are, natively. Read by XMLHttpRequest and FormData to send them. */
  readonly data: NativeBlob
  // Kept only so it's collected with the Blob (and its slices, which share it).
  private readonly collector: object | undefined

  constructor(parts: BlobPart[] = [], { type = '' }: BlobPropertyBag = {}) {
    const created = native.blobCreate(parts.map(nativeBlobPart))
    if (!created) throw new Error('The blob has been released')

    const { blobId, size } = created

    this.data = { blobId, offset: 0, size, type: type.toLowerCase() }
    this.collector = globalThis.__blobCollector?.(blobId)
  }

  /** A Blob for bytes native already holds: a download's, or a slice's. */
  static fromNative(data: NativeBlob, collector?: object): Blob {
    const blob = Object.create(Blob.prototype) as Blob
    Object.assign(blob, { data, collector: collector ?? globalThis.__blobCollector?.(data.blobId) })

    return blob
  }

  get size(): number {
    return this.data.size
  }

  get type(): string {
    return this.data.type
  }

  slice(start = 0, end = this.size, type = ''): Blob {
    const from = clampedIndex(start, this.size)
    const to = Math.max(from, clampedIndex(end, this.size))
    const data = { ...this.data, offset: this.data.offset + from, size: to - from, type }

    return Blob.fromNative(data, this.collector)
  }

  async text(): Promise<string> {
    return this.read('text')
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return toByteArray(this.read('base64')).buffer as ArrayBuffer
  }

  /** Synchronous: the bytes are in native memory. */
  read(encoding: 'text' | 'base64'): string {
    const { blobId, offset, size } = this.data
    const contents = native.blobRead(blobId, offset, size, encoding)
    if (contents === null) throw new Error('The blob has been released')

    return contents
  }
}

export class File extends Blob {
  readonly name: string
  readonly lastModified: number

  constructor(
    parts: BlobPart[],
    name: string,
    { type, lastModified = Date.now() }: BlobPropertyBag & { lastModified?: number } = {},
  ) {
    super(parts, { type })
    this.name = name
    this.lastModified = lastModified
  }
}

function nativeBlobPart(part: BlobPart): NativeBlobPart {
  if (typeof part === 'string') return { string: part }
  if (part instanceof Blob) return { blob: part.data }

  return { base64: fromByteArray(bytesOf(part)) }
}

export function bytesOf(buffer: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (buffer instanceof ArrayBuffer) return new Uint8Array(buffer)

  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

function clampedIndex(index: number, size: number): number {
  const fromStart = index < 0 ? size + index : index

  return Math.min(Math.max(fromStart, 0), size)
}

type ReadResult = string | ArrayBuffer | null

export class FileReader extends EventTarget {
  static readonly EMPTY = 0
  static readonly LOADING = 1
  static readonly DONE = 2
  readonly EMPTY = 0
  readonly LOADING = 1
  readonly DONE = 2

  readyState = 0
  result: ReadResult = null
  error: Error | null = null

  onloadstart: ((event: ProgressEvent) => void) | null = null
  onprogress: ((event: ProgressEvent) => void) | null = null
  onload: ((event: ProgressEvent) => void) | null = null
  onloadend: ((event: ProgressEvent) => void) | null = null
  onerror: ((event: ProgressEvent) => void) | null = null
  onabort: ((event: ProgressEvent) => void) | null = null

  private readId = 0

  // Only UTF-8: the encoding argument is ignored.
  readAsText(blob: Blob): void {
    this.startReading(blob, () => blob.read('text'))
  }

  readAsDataURL(blob: Blob): void {
    const type = blob.type || 'application/octet-stream'

    this.startReading(blob, () => `data:${type};base64,${blob.read('base64')}`)
  }

  readAsArrayBuffer(blob: Blob): void {
    this.startReading(blob, () => toByteArray(blob.read('base64')).buffer as ArrayBuffer)
  }

  abort(): void {
    if (this.readyState !== this.LOADING) return

    this.readId++
    this.finish(null, null, 'abort', 0)
  }

  // Asynchronous like the browser's, though the read itself is synchronous.
  private startReading(blob: Blob, read: () => ReadResult) {
    if (this.readyState === this.LOADING) throw new Error('The FileReader is already reading')

    const readId = ++this.readId
    this.readyState = this.LOADING
    this.result = null
    this.error = null
    this.dispatchProgress('loadstart', 0, blob.size)

    setTimeout(() => {
      if (readId !== this.readId) return

      try {
        this.finish(read(), null, 'load', blob.size)
      } catch (error) {
        this.finish(null, error as Error, 'error', 0)
      }
    })
  }

  private finish(result: ReadResult, error: Error | null, outcome: string, loaded: number) {
    this.readyState = this.DONE
    this.result = result
    this.error = error
    this.dispatchProgress(outcome, loaded, loaded)
    this.dispatchProgress('loadend', loaded, loaded)
  }

  private dispatchProgress(type: string, loaded: number, total: number) {
    this.dispatchEvent(new ProgressEvent(type, { lengthComputable: true, loaded, total }))
  }
}
