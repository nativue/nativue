// The functions packages add natively, for their JS side to call:
//   const impact = requireNativeFunction<(style: string) => void>('haptics.impact')
//   const takePhoto = requireNativeFunction<() => Promise<string>>('camera.takePhoto')
// Native addFunction ones return synchronously, addAsyncFunction ones return a Promise.
type AnyFunction = (...args: never[]) => unknown
type NativeFunctions = Record<string, ((...args: unknown[]) => unknown) | undefined>
type PendingCall = { resolve: (value: unknown) => void; reject: (error: Error) => void }

const pendingCalls = new Map<number, PendingCall>()
let nextCallId = 1

/**
 * An async native function's rejection. `code` is the plugin's, when it gave one:
 * 'ERR_PERMISSION_DENIED', 'ERR_UNAVAILABLE', 'ERR_CANCELED', 'ERR_INVALID_ARGUMENT', or its own.
 */
export class NativeError extends Error {
  readonly code: string | undefined

  constructor(message: string, code: string | undefined) {
    super(message)
    this.name = 'NativeError'
    this.code = code
  }
}

globalThis.__asyncFunctionFinished = (callId, value, errorMessage, errorCode) => {
  const call = pendingCalls.get(callId)
  if (!call) return

  pendingCalls.delete(callId)
  if (errorMessage === null) call.resolve(value)
  else call.reject(new NativeError(errorMessage, errorCode ?? undefined))
}

function asyncCaller(nativeFunction: (...args: unknown[]) => unknown) {
  return (...args: unknown[]) =>
    new Promise((resolve, reject) => {
      const callId = nextCallId++
      pendingCalls.set(callId, { resolve, reject })
      nativeFunction(callId, ...args)
    })
}

export function requireNativeFunction<Function extends AnyFunction>(name: string): Function {
  const nativeFunctions = __native as unknown as NativeFunctions
  const syncFunction = nativeFunctions[`plugin:${name}`]
  const asyncFunction = nativeFunctions[`pluginAsync:${name}`]

  if (syncFunction) return syncFunction as unknown as Function
  if (asyncFunction) return asyncCaller(asyncFunction) as unknown as Function

  throw new Error(
    `The native function "${name}" isn't in the app. A package's native code is added when the app is built: rebuild it (npx nativue run ios / android).`,
  )
}
