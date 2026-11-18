// Event, ProgressEvent, EventTarget, AbortController and AbortSignal, like the browser's: Hermes has none
// of them, and XMLHttpRequest and fetch build on them.

export class Event {
  readonly type: string
  target: EventTarget | null = null
  defaultPrevented = false

  constructor(type: string) {
    this.type = type
  }

  preventDefault(): void {
    this.defaultPrevented = true
  }
}

export interface ProgressEventInit {
  lengthComputable?: boolean
  loaded?: number
  total?: number
}

export class ProgressEvent extends Event {
  readonly lengthComputable: boolean
  readonly loaded: number
  readonly total: number

  constructor(
    type: string,
    { lengthComputable = false, loaded = 0, total = 0 }: ProgressEventInit = {},
  ) {
    super(type)
    this.lengthComputable = lengthComputable
    this.loaded = loaded
    this.total = total
  }
}

type EventListener = ((event: any) => void) | { handleEvent(event: any): void }

// The `on<type>` property of a target (onload, onabort...) runs before the listeners, as in browsers.
export class EventTarget {
  private readonly listenersByType = new Map<string, Set<EventListener>>()

  addEventListener(type: string, listener: EventListener | null): void {
    if (!listener) return

    const listeners = this.listenersByType.get(type) ?? new Set()
    listeners.add(listener)
    this.listenersByType.set(type, listeners)
  }

  removeEventListener(type: string, listener: EventListener | null): void {
    if (listener) this.listenersByType.get(type)?.delete(listener)
  }

  dispatchEvent(event: Event): boolean {
    event.target = this

    const handler = (this as unknown as Record<string, unknown>)[`on${event.type}`]
    if (typeof handler === 'function') handler.call(this, event)

    for (const listener of [...(this.listenersByType.get(event.type) ?? [])]) {
      if (typeof listener === 'function') listener.call(this, event)
      else listener.handleEvent(event)
    }

    return !event.defaultPrevented
  }

  protected hasListeners(type: string): boolean {
    return (this.listenersByType.get(type)?.size ?? 0) > 0
  }
}

// Like the browser's DOMException with that name: code checks `error.name`.
export function namedError(name: string, message: string): Error {
  const error = new Error(message)
  error.name = name

  return error
}

export class AbortSignal extends EventTarget {
  aborted = false
  reason: unknown = undefined
  onabort: ((event: Event) => void) | null = null

  static abort(reason?: unknown): AbortSignal {
    const controller = new AbortController()
    controller.abort(reason)

    return controller.signal
  }

  static timeout(milliseconds: number): AbortSignal {
    const controller = new AbortController()
    setTimeout(() => controller.abort(namedError('TimeoutError', 'signal timed out')), milliseconds)

    return controller.signal
  }

  throwIfAborted(): void {
    if (this.aborted) throw this.reason
  }
}

export class AbortController {
  readonly signal = new AbortSignal()

  abort(reason: unknown = namedError('AbortError', 'signal is aborted without reason')): void {
    if (this.signal.aborted) return

    this.signal.aborted = true
    this.signal.reason = reason
    this.signal.dispatchEvent(new Event('abort'))
  }
}
