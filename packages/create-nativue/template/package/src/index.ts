import { requireNativeFunction } from '@nativue/core'

// ios/ and android/: addFunction returns right away; addAsyncFunction returns a Promise.
export const hello = requireNativeFunction<(name: string) => string>('__MODULE__.hello')
