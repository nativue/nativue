// Design tokens shared by every screen of the demo. The first ones are the nativue brand colors.
import type { Style } from 'vue'

export const colors = {
  ink: '#0b1220',
  inkSoft: '#0b12200f',
  green: '#0e9f84', // the "vue" of the logo: accents on light backgrounds
  greenSoft: '#0e9f841f',
  mint: '#4af2ae', // accents on dark backgrounds
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

export const spacing = { small: 8, medium: 16, large: 24 }

export const radius = { small: 10, medium: 16, large: 24 }

export const cardShadow: Style = {
  shadowColor: '#000000',
  shadowOpacity: 0.06,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
}
