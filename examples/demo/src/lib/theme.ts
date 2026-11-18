// Design tokens shared by every screen of the demo, light or dark with the system. The first ones
// are the nativue brand colors.
import { Appearance, shallowReactive, type ColorScheme, type Style } from 'vue'

const LIGHT_COLORS = {
  ink: '#0b1220', // filled buttons and the hero
  inkSoft: '#0b12200f',
  green: '#0e9f84', // the "vue" of the logo: accents
  greenSoft: '#0e9f841f',
  mint: '#4af2ae', // accents on ink
  seaGreen: '#10b39b',
  background: '#f1f5f9',
  surface: '#ffffff',
  text: '#0b1220',
  secondaryText: '#6e6e73',
  tertiaryText: '#aeaeb2',
  separator: '#e5e5ea',
  pressed: '#e9e9ee',
  red: '#ff3b30',
  orange: '#ff9500',
  blue: '#0a84ff',
  purple: '#af52de',
  pink: '#ff2d55',
  teal: '#30b0c7',
}

// Ink is the background; ink-filled things lift off it.
const DARK_COLORS: typeof LIGHT_COLORS = {
  ...LIGHT_COLORS,
  ink: '#2b3852',
  inkSoft: '#f1f5f914',
  greenSoft: '#0e9f8433',
  background: '#0b1220',
  surface: '#161f30',
  text: '#f1f5f9',
  secondaryText: '#98a2b3',
  tertiaryText: '#5d6b82',
  separator: '#253047',
  pressed: '#1f2a3d',
}

function colorsFor(colorScheme: ColorScheme) {
  return colorScheme === 'dark' ? DARK_COLORS : LIGHT_COLORS
}

export const colors = shallowReactive({ ...colorsFor(Appearance.getColorScheme()) })

// Read inside a computed (`computed(() => StyleSheet.create({...}))`), styles follow the scheme.
Appearance.addChangeListener((colorScheme) => Object.assign(colors, colorsFor(colorScheme)))

export const spacing = { small: 8, medium: 16, large: 24 }

export const radius = { small: 10, medium: 16, large: 24 }

export const cardShadow: Style = {
  shadowColor: '#000000',
  shadowOpacity: 0.06,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
}
