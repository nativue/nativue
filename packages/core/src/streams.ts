// ReadableStream, like the browser's (Hermes has none), for Blob.stream(): read with getReader() or
// iterate it. Chunks are pulled only when read.
// Limitation: Default readers only: no pipeTo/pipeThrough, tee, byte (BYOB) readers or queuing strategies.
// Use a full web streams polyfill if a library needs those.

export interface UnderlyingSource<Chunk> {
  start?(controller: ReadableStreamDefaultController<Chunk>): void | Promise<void>
  pull?(controller: ReadableStreamDefaultController<Chunk>): void | Promise<void>
  cancel?(reason?: unknown): void | Promise<void>
}

export type ReadResult<Chunk> = { done: false; value: Chunk } | { done: true; value: undefined }

interface PendingRead<Chunk> {
  resolve(result: ReadResult<Chunk>): void
  reject(error: unknown): void
}

export class ReadableStreamDefaultController<Chunk> {
  constructor(private readonly stream: ReadableStream<Chunk>) {}

  get desiredSize(): number | null {
    return this.stream.desiredSize()
  }

  enqueue(chunk: Chunk): void {
    this.stream.enqueue(chunk)
  }

  close(): void {
    this.stream.close()
  }

  error(error?: unknown): void {
    this.stream.fail(error)
  }
}

export class ReadableStream<Chunk = Uint8Array> {
  private readonly source: UnderlyingSource<Chunk>
  private readonly controller = new ReadableStreamDefaultController<Chunk>(this)
  private readonly queue: Chunk[] = []
  private readonly pendingReads: PendingRead<Chunk>[] = []
  private state: 'readable' | 'closed' | 'errored' = 'readable'
  private storedError: unknown = undefined
  private started = false
  private pulling = false
  private reader: ReadableStreamDefaultReader<Chunk> | null = null

  constructor(source: UnderlyingSource<Chunk> = {}) {
    this.source = source

    Promise.resolve()
      .then(() => source.start?.(this.controller))
      .then(
        () => {
          this.started = true
          this.pullIfNeeded()
        },
        (error) => this.fail(error),
      )
  }

  get locked(): boolean {
    return this.reader !== null
  }

  getReader(): ReadableStreamDefaultReader<Chunk> {
    if (this.reader) throw new TypeError('The stream is locked to a reader')

    this.reader = new ReadableStreamDefaultReader(this)

    return this.reader
  }

  cancel(reason?: unknown): Promise<void> {
    if (this.locked) return Promise.reject(new TypeError('The stream is locked to a reader'))

    return this.cancelSource(reason)
  }

  values({ preventCancel = false } = {}): AsyncIterableIterator<Chunk> {
    const reader = this.getReader()

    return {
      next: async () => {
        const result = await reader.read()
        if (result.done) reader.releaseLock()

        return result as IteratorResult<Chunk>
      },
      return: async (value?: unknown) => {
        if (!preventCancel) await reader.cancel()
        reader.releaseLock()

        return { done: true, value } as IteratorResult<Chunk>
      },
      [Symbol.asyncIterator]() {
        return this
      },
    }
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<Chunk> {
    return this.values()
  }

  // ---------- For the reader and the controller ----------

  /** Next chunk, waiting for the source if none is queued. */
  read(): Promise<ReadResult<Chunk>> {
    if (this.queue.length > 0) return Promise.resolve({ done: false, value: this.queue.shift()! })
    if (this.state === 'closed') return Promise.resolve({ done: true, value: undefined })
    if (this.state === 'errored') return Promise.reject(this.storedError)

    return new Promise((resolve, reject) => {
      this.pendingReads.push({ resolve, reject })
      this.pullIfNeeded()
    })
  }

  release(reader: ReadableStreamDefaultReader<Chunk>): void {
    if (this.reader === reader) this.reader = null
  }

  cancelSource(reason?: unknown): Promise<void> {
    if (this.state !== 'readable') return Promise.resolve()

    this.queue.length = 0
    this.close()

    return Promise.resolve(this.source.cancel?.(reason)).then(() => undefined)
  }

  desiredSize(): number | null {
    if (this.state === 'errored') return null
    if (this.state === 'closed') return 0

    return this.pendingReads.length - this.queue.length
  }

  enqueue(chunk: Chunk): void {
    if (this.state !== 'readable') throw new TypeError('The stream is closed')

    const pendingRead = this.pendingReads.shift()
    if (pendingRead) pendingRead.resolve({ done: false, value: chunk })
    else this.queue.push(chunk)
  }

  close(): void {
    if (this.state !== 'readable') return

    this.state = 'closed'
    this.pendingReads.splice(0).forEach((read) => read.resolve({ done: true, value: undefined }))
  }

  fail(error: unknown): void {
    if (this.state !== 'readable') return

    this.state = 'errored'
    this.storedError = error
    this.queue.length = 0
    this.pendingReads.splice(0).forEach((read) => read.reject(error))
  }

  // Pulls one chunk at a time, only while someone is waiting for one.
  private pullIfNeeded() {
    const waiting = this.pendingReads.length > 0
    if (!this.started || this.pulling || !waiting || this.state !== 'readable' || !this.source.pull)
      return

    this.pulling = true
    Promise.resolve()
      .then(() => this.source.pull!(this.controller))
      .then(
        () => {
          this.pulling = false
          this.pullIfNeeded()
        },
        (error) => this.fail(error),
      )
  }
}

export class ReadableStreamDefaultReader<Chunk> {
  private stream: ReadableStream<Chunk> | null

  constructor(stream: ReadableStream<Chunk>) {
    this.stream = stream
  }

  read(): Promise<ReadResult<Chunk>> {
    if (!this.stream) return Promise.reject(new TypeError('The reader has been released'))

    return this.stream.read()
  }

  cancel(reason?: unknown): Promise<void> {
    return this.stream?.cancelSource(reason) ?? Promise.resolve()
  }

  releaseLock(): void {
    this.stream?.release(this)
    this.stream = null
  }
}
