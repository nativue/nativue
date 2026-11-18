// The platform the app runs on, and the system's light or dark appearance.
import { readonly, shallowRef, type Ref } from '@vue/runtime-core'

export type ColorScheme = 'light' | 'dark'
export type PlatformOS = 'ios' | 'android'
type ColorSchemeListener = (colorScheme: ColorScheme) => void

const colorSchemeListeners = new Set<ColorSchemeListener>()
let colorScheme: ColorScheme = __native.colorScheme()
const colorSchemeRef = shallowRef(colorScheme)

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
