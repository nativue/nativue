// The platform the app runs on, the system's light or dark appearance, and the window's size.
import { readonly, shallowRef, type Ref } from '@vue/runtime-core'

export type ColorScheme = 'light' | 'dark'
export type PlatformOS = 'ios' | 'android'
export type WindowSize = { width: number; height: number }
type ColorSchemeListener = (colorScheme: ColorScheme) => void

const colorSchemeListeners = new Set<ColorSchemeListener>()
let colorScheme: ColorScheme = __native.colorScheme()
const colorSchemeRef = shallowRef(colorScheme)
const windowSizeRef = shallowRef<WindowSize>(__native.windowSize())

//   Platform.OS === 'ios'
//   Platform.select({ ios: 17, android: 16 })
export const Platform = {
  OS: __native.platform(),

  select<Value>(values: { ios?: Value; android?: Value; default?: Value }): Value | undefined {
    return values[Platform.OS] ?? values.default
  },
}

//   Appearance.getColorScheme() -> 'light' | 'dark'
//   const stop = Appearance.addChangeListener((colorScheme) => …)
export const Appearance = {
  getColorScheme(): ColorScheme {
    return colorScheme
  },

  /** Returns a function that removes the listener. */
  addChangeListener(listener: ColorSchemeListener): () => void {
    colorSchemeListeners.add(listener)

    return () => colorSchemeListeners.delete(listener)
  },
}

//   const colorScheme = useColorScheme()   'light' | 'dark', follows the system
export function useColorScheme(): Readonly<Ref<ColorScheme>> {
  return readonly(colorSchemeRef)
}

// Native calls it when the system switches between light and dark.
globalThis.__colorSchemeChanged = (nextColorScheme) => {
  if (nextColorScheme === colorScheme) return

  colorScheme = nextColorScheme
  colorSchemeRef.value = nextColorScheme
  colorSchemeListeners.forEach((listener) => listener(nextColorScheme))
}

// Dimensions.get('window') -> { width, height } in points, right now.
export const Dimensions = {
  get(_dimension: 'window'): WindowSize {
    return windowSizeRef.value
  },
}

//   const window = useWindowDimensions()   { width, height }, follows rotation and split view
export function useWindowDimensions(): Readonly<Ref<WindowSize>> {
  return readonly(windowSizeRef)
}

// Native calls it when the window is resized: rotation, split view.
globalThis.__windowSizeChanged = (windowSize) => {
  windowSizeRef.value = windowSize
}
