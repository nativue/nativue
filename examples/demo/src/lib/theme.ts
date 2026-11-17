// Design tokens shared by every screen of the demo.
import type { Style } from 'vue'

export const colors = {
  green: '#42b883',
  greenSoft: '#42b8831f',
  navy: '#213547',
  navySoft: '#2135470f',
  background: '#f2f2f7',
  surface: '#ffffff',
  text: '#1c1c1e',
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
