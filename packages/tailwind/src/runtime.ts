// The run-time side: gives `class` the styles converted when the app was built (index.mjs). A class
// string is resolved once per state (color scheme, pressed, focused, disabled) and cached.
import {
  Appearance,
  Platform,
  setClassStyleResolver,
  type Style,
  type TransformStep,
} from '@nativue/core'
import { resolveVariables } from './variables.mjs'

type Condition = 'dark' | 'pressed' | 'focused' | 'disabled' | 'ios' | 'android'
/**
 * [order, style, conditions]: the order of the utility's rule in Tailwind's CSS, where later rules
 * win, and the variant's conditions (dark:active:… has two), all of which must hold.
 */
type ClassStyle = [order: number, style: Style, conditions?: Condition[]]

// Transforms add up, as CSS's translate, rotate and scale properties do. Variables ('--tw-gradient-from')
// add up too, the last class's winning, and resolve the backgroundImage that reads them.
function mergeStyles(styles: Style[], initialVariables: Record<string, string>): Style {
  const merged: Record<string, unknown> = {}
  const variables = { ...initialVariables }
  const transform: TransformStep[] = []

  for (const style of styles) {
    for (const [property, value] of Object.entries(style)) {
      if (property.startsWith('--')) variables[property] = value as string
      else merged[property] = value
    }
    if (style.transform) transform.push(...style.transform)
  }

  if (transform.length > 0) merged.transform = transform
  if (typeof merged.backgroundImage === 'string') {
    const backgroundImage = resolveVariables(merged.backgroundImage, (name) => variables[name])

    if (backgroundImage === null) delete merged.backgroundImage
    else merged.backgroundImage = backgroundImage
  }

  return merged as Style
}

/**
 * The styles the build converted (index.mjs), and the initial values of the variables they read
 * (`variables`), for those no class sets.
 */
export function registerClassStyles(
  classStyles: Record<string, ClassStyle>,
  initialVariables: Record<string, string> = {},
): void {
  const stylesByKey = new Map<string, Style>()

  setClassStyleResolver((className, { pressed, focused, disabled }) => {
    const colorScheme = Appearance.getColorScheme()
    const key = `${colorScheme} ${pressed} ${focused} ${disabled} ${className}`
    const cachedStyle = stylesByKey.get(key)
    if (cachedStyle) return cachedStyle

    const holds: Record<Condition, boolean> = {
      dark: colorScheme === 'dark',
      pressed,
      focused,
      disabled,
      ios: Platform.OS === 'ios',
      android: Platform.OS === 'android',
    }
    const entries = className
      .split(/\s+/)
      .map((name) => classStyles[name])
      .filter((entry) => entry !== undefined)
      .filter(([, , conditions = []]) => conditions.every((condition) => holds[condition]))
      .sort(([firstOrder], [secondOrder]) => firstOrder - secondOrder)
    const style = mergeStyles(
      entries.map(([, entryStyle]) => entryStyle),
      initialVariables,
    )
    stylesByKey.set(key, style)

    return style
  })
}
