// Turns the CSS Tailwind generates into nativue styles: each `.class { … }` utility becomes a style
// object, with theme variables, calc() and colors resolved at build time. The variants native apps
// have (dark:, active:, focus:, disabled:, ios:, android:) become conditions; other variants, and CSS properties the
// native views don't have, are reported instead.

const ROOT_FONT_SIZE = 16 // rem, in points
const INFINITE_LENGTH = 9999 // rounded-full is calc(infinity * 1px)

// ---------- CSS parsing ----------

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** [{ prelude, children }] for blocks and [{ property, value }] for declarations, in order. */
function parseBlock(css, start = 0) {
  const items = []
  let buffer = ''
  let index = start

  function flushDeclaration() {
    const colon = buffer.indexOf(':')
    if (colon > 0) {
      items.push({ property: buffer.slice(0, colon).trim(), value: buffer.slice(colon + 1).trim() })
    }
    buffer = ''
  }

  for (; index < css.length; index++) {
    const character = css[index]

    if (character === '"' || character === "'") {
      const end = css.indexOf(character, index + 1)
      buffer += css.slice(index, end + 1)
      index = end
    } else if (character === '{') {
      const block = parseBlock(css, index + 1)
      items.push({ prelude: buffer.trim(), children: block.items })
      buffer = ''
      index = block.end
    } else if (character === ';') flushDeclaration()
    else if (character === '}') break
    else buffer += character
  }
  flushDeclaration()

  return { items, end: index }
}

// ---------- Selectors ----------

const CSS_ESCAPE = /\\([0-9a-f]{1,6} ?|[\s\S])/gi

function unescapeCss(text) {
  return text.replace(CSS_ESCAPE, (_, escaped) =>
    /^[0-9a-f]/i.test(escaped) && escaped.trim().length > 1
      ? String.fromCodePoint(parseInt(escaped, 16))
      : escaped,
  )
}

// The element states native apps have, by the pseudo-class Tailwind's variant uses.
const CONDITION_BY_PSEUDO_CLASS = {
  ':active': 'pressed',
  ':focus': 'focused',
  ':disabled': 'disabled',
}
const UTILITY_SELECTOR = new RegExp(
  String.raw`^\.((?:\\[\s\S]|[^\\\s.:#[\]>+~,()*])+)((?:` +
    Object.keys(CONDITION_BY_PSEUDO_CLASS).join('|') +
    ')*)$',
)

/**
 * `.w-1\/2` -> { className: 'w-1/2', states: [] }, `.active\:p-2:active` -> { className, states:
 * ['pressed'] }; null for anything else (`.hover\:x:hover`, `:root`, `*`).
 */
function utilitySelector(selector) {
  const match = UTILITY_SELECTOR.exec(selector)
  if (!match) return null

  const pseudoClasses = match[2].match(/:[a-z]+/g) ?? []

  return {
    className: unescapeCss(match[1]),
    states: pseudoClasses.map((pseudoClass) => CONDITION_BY_PSEUDO_CLASS[pseudoClass]),
  }
}

/**
 * The utility a rule belongs to, its last class: `.hover\:bg-red-500:hover` -> 'hover:bg-red-500',
 * `:is(:where(.group):hover .group-hover\:p-2)` -> 'group-hover:p-2'.
 */
function utilityClassName(selector) {
  const matches = [...selector.matchAll(/\.((?:\\[\s\S]|[^\\\s.:#[\]>+~,()*])+)/g)]

  return matches.length > 0 ? unescapeCss(matches.at(-1)[1]) : null
}

// ---------- Values ----------

/** Splits on `separator` outside parentheses: '0 4px rgb(0 0 0)' -> ['0', '4px', 'rgb(0 0 0)']. */
function splitTopLevel(value, separator) {
  const parts = []
  let depth = 0
  let current = ''

  for (const character of value) {
    if (character === '(') depth++
    if (character === ')') depth--

    const splitsHere = separator === ' ' ? /\s/.test(character) : character === separator
    if (splitsHere && depth === 0) {
      if (current.trim()) parts.push(current.trim())
      current = ''
    } else current += character
  }
  if (current.trim()) parts.push(current.trim())

  return parts
}

/** The index of the parenthesis closing the one at `start`. */
function closingParenthesis(text, start) {
  let depth = 0

  for (let index = start; index < text.length; index++) {
    if (text[index] === '(') depth++
    if (text[index] === ')' && --depth === 0) return index
  }

  return -1
}

/**
 * Replaces var(--name, fallback) with the variable's value: the rule's own, then the theme's, then
 * @property's initial value, then the fallback. null when one can't be resolved.
 */
function resolveVariables(value, lookup) {
  const start = value.indexOf('var(')
  if (start === -1) return value

  const end = closingParenthesis(value, start + 3)
  const [name, ...fallbackParts] = splitTopLevel(value.slice(start + 4, end), ',')
  const fallback = fallbackParts.length > 0 ? fallbackParts.join(',') : null
  const replacement =
    lookup(name.trim()) ?? (fallback === null ? null : resolveVariables(fallback, lookup))
  if (replacement === null) return null

  return resolveVariables(value.slice(0, start) + replacement + value.slice(end + 1), lookup)
}

// calc() and plain lengths, as { number, unit }: '', 'px' (rem converted), '%' or 'deg'.
const UNIT_SCALE = {
  '': ['', 1],
  px: ['px', 1],
  rem: ['px', ROOT_FONT_SIZE],
  '%': ['%', 1],
  deg: ['deg', 1],
}
const TOKEN = /\s*(infinity|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?([a-z%]*)|calc\(|[()*/+-])/giy

function tokenize(expression) {
  const tokens = []
  TOKEN.lastIndex = 0

  while (TOKEN.lastIndex < expression.length) {
    const match = TOKEN.exec(expression)
    if (!match) return expression.slice(TOKEN.lastIndex).trim() ? null : tokens

    tokens.push(match[1].toLowerCase())
  }

  return tokens
}

function combineUnits(left, right, operator) {
  if (operator === '*' || operator === '/') {
    if (left.unit && right.unit) return null
    const number = operator === '*' ? left.number * right.number : left.number / right.number

    return { number, unit: left.unit || right.unit }
  }

  if (left.unit !== right.unit && left.number !== 0 && right.number !== 0) return null
  const number = operator === '+' ? left.number + right.number : left.number - right.number

  return { number, unit: left.unit || right.unit }
}

/** Evaluates a length or a calc() of lengths; null for what native views can't express (vw, em…). */
export function evaluateLength(value) {
  const tokens = tokenize(value)
  if (!tokens) return null

  let position = 0

  function primary() {
    const token = tokens[position++]
    if (token === '(' || token === 'calc(') {
      const result = sum()
      position++ // ')'
      return result
    }
    if (token === '-') {
      const operand = primary()
      return operand && { number: -operand.number, unit: operand.unit }
    }
    if (token === 'infinity') return { number: Infinity, unit: '' }

    const match = /^(-?[\d.e-]+)([a-z%]*)$/.exec(token ?? '')
    const scale = match && UNIT_SCALE[match[2]]
    if (!scale) return null

    return { number: Number(match[1]) * scale[1], unit: scale[0] }
  }

  function chain(operand, operators) {
    let result = operand()
    while (result && operators.includes(tokens[position])) {
      const operator = tokens[position++]
      const right = operand()
      result = right && combineUnits(result, right, operator)
    }

    return result
  }

  const product = () => chain(primary, ['*', '/'])
  const sum = () => chain(product, ['+', '-'])
  const result = sum()

  return result && position === tokens.length ? result : null
}

function finite(number) {
  return Number.isFinite(number)
    ? Math.round(number * 1000) / 1000
    : Math.sign(number) * INFINITE_LENGTH
}

/** A Yoga dimension: points, 'auto' or a percentage. */
function dimension(value) {
  if (value === 'auto') return 'auto'

  const length = evaluateLength(value)
  if (!length || length.unit === 'deg') return null

  return length.unit === '%' ? `${finite(length.number)}%` : finite(length.number)
}

/** Points only (gap, border width, font size…). */
function points(value) {
  const length = evaluateLength(value)

  return length && (length.unit === 'px' || length.unit === '') ? finite(length.number) : null
}

/** opacity: 50% or 0.5. */
function fraction(value) {
  const length = evaluateLength(value)
  if (!length || (length.unit !== '' && length.unit !== '%')) return null

  return length.unit === '%' ? length.number / 100 : length.number
}

// ---------- Colors ----------

function hexByte(channel) {
  return Math.round(Math.min(1, Math.max(0, channel)) * 255)
    .toString(16)
    .padStart(2, '0')
}

function hexColor({ red, green, blue, alpha }) {
  const opaque = `#${hexByte(red)}${hexByte(green)}${hexByte(blue)}`

  return alpha >= 1 ? opaque : `${opaque}${hexByte(alpha)}`
}

function gammaEncode(linear) {
  return linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055
}

// OKLab -> linear sRGB -> sRGB (https://bottosson.github.io/posts/oklab/).
function oklabToRgb(lightness, a, b, alpha) {
  const long = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const medium = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const short = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3

  return {
    red: gammaEncode(4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short),
    green: gammaEncode(-1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short),
    blue: gammaEncode(-0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short),
    alpha,
  }
}

function channelValue(text, percentScale) {
  return text.endsWith('%') ? (Number(text.slice(0, -1)) / 100) * percentScale : Number(text)
}

/** 'oklch(63.7% 0.237 25.331 / 50%)' -> { name: 'oklch', channels: [...], alpha: 0.5 }. */
function colorFunction(value) {
  const match = /^([a-z]+)\((.*)\)$/i.exec(value)
  if (!match) return null

  const [channelText, alphaText] = match[2].includes('/')
    ? match[2].split('/')
    : [match[2].replaceAll(',', ' '), null]
  const channels = channelText.trim().split(/[\s,]+/)
  const legacyAlpha = alphaText === null && channels.length === 4 ? channels.pop() : null // rgba(0, 0, 0, 0.5)
  const alpha = channelValue((alphaText ?? legacyAlpha ?? '1').trim(), 1)

  return { name: match[1].toLowerCase(), channels, alpha }
}

function parseHex(value) {
  const digits =
    value.length <= 5 ? [...value.slice(1)].map((digit) => digit + digit).join('') : value.slice(1)
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(digits)) return null

  const channel = (index) => parseInt(digits.slice(index * 2, index * 2 + 2), 16) / 255

  return {
    red: channel(0),
    green: channel(1),
    blue: channel(2),
    alpha: digits.length === 8 ? channel(3) : 1,
  }
}

function parseRgba(value) {
  if (value === 'transparent') return { red: 0, green: 0, blue: 0, alpha: 0 }
  if (value.startsWith('#')) return parseHex(value)

  const color = colorFunction(value)
  if (!color) return null

  const numbers = color.channels.map((channel, index) => {
    if (color.name === 'oklch') return channelValue(channel, index === 1 ? 0.4 : 1)
    if (color.name === 'oklab') return channelValue(channel, index === 0 ? 1 : 0.4)
    return channelValue(channel, 255) / 255 // rgb()
  })

  if (color.name === 'rgb' || color.name === 'rgba') {
    return { red: numbers[0], green: numbers[1], blue: numbers[2], alpha: color.alpha }
  }
  if (color.name === 'oklab') return oklabToRgb(numbers[0], numbers[1], numbers[2], color.alpha)
  if (color.name === 'oklch') {
    const [lightness, chroma, hue] = numbers
    const radians = (hue * Math.PI) / 180

    return oklabToRgb(
      lightness,
      chroma * Math.cos(radians),
      chroma * Math.sin(radians),
      color.alpha,
    )
  }

  return null
}

// Opacity modifiers (bg-black/50) mix the color with transparent.
function parseColorMix(value) {
  const match = /^color-mix\(in [a-z]+,\s*(.+)\)$/i.exec(value)
  if (!match) return null

  const [first, second] = splitTopLevel(match[1], ',')
  if (second?.trim() !== 'transparent') return null

  const [color, percentage = '100%'] = splitTopLevel(first, ' ')
  const rgba = parseRgba(color)

  return rgba && { ...rgba, alpha: rgba.alpha * channelValue(percentage, 1) }
}

function rgbaOf(value) {
  return value.startsWith('color-mix(') ? parseColorMix(value) : parseRgba(value)
}

/** A color the native side understands: '#rrggbb(aa)', or a CSS color name as it is. */
export function color(value) {
  const rgba = rgbaOf(value.trim())
  if (rgba) return hexColor(rgba)

  return /^[a-z]+$/i.test(value) && value !== 'currentcolor' && value !== 'inherit' ? value : null
}

// ---------- Properties ----------

const DIMENSION_PROPERTIES = {
  width: ['width'],
  height: ['height'],
  'min-width': ['minWidth'],
  'min-height': ['minHeight'],
  'max-width': ['maxWidth'],
  'max-height': ['maxHeight'],
  'flex-basis': ['flexBasis'],
  top: ['top'],
  right: ['right'],
  bottom: ['bottom'],
  left: ['left'],
  inset: ['top', 'right', 'bottom', 'left'],
  'inset-inline': ['left', 'right'],
  'inset-block': ['top', 'bottom'],
}

for (const box of ['padding', 'margin']) {
  DIMENSION_PROPERTIES[box] = [box]
  DIMENSION_PROPERTIES[`${box}-inline`] = [`${box}Horizontal`]
  DIMENSION_PROPERTIES[`${box}-block`] = [`${box}Vertical`]
  DIMENSION_PROPERTIES[`${box}-inline-start`] = [`${box}Start`]
  DIMENSION_PROPERTIES[`${box}-inline-end`] = [`${box}End`]

  for (const edge of ['Top', 'Right', 'Bottom', 'Left']) {
    DIMENSION_PROPERTIES[`${box}-${edge.toLowerCase()}`] = [`${box}${edge}`]
  }
}

const POINT_PROPERTIES = {
  gap: 'gap',
  'row-gap': 'rowGap',
  'column-gap': 'columnGap',
  'border-width': 'borderWidth',
  'border-radius': 'borderRadius',
  'font-size': 'fontSize',
}

const COLOR_PROPERTIES = {
  color: 'color',
  'background-color': 'backgroundColor',
  'border-color': 'borderColor',
}

const FLEX_START_END = {
  start: 'flex-start',
  end: 'flex-end',
  'flex-start': 'flex-start',
  'flex-end': 'flex-end',
}

const KEYWORD_PROPERTIES = {
  display: ['display', { flex: 'flex', 'inline-flex': 'flex', none: 'none' }],
  position: ['position', { relative: 'relative', absolute: 'absolute', static: 'static' }],
  'flex-direction': [
    'flexDirection',
    {
      row: 'row',
      column: 'column',
      'row-reverse': 'row-reverse',
      'column-reverse': 'column-reverse',
    },
  ],
  'flex-wrap': ['flexWrap', { wrap: 'wrap', nowrap: 'nowrap', 'wrap-reverse': 'wrap-reverse' }],
  'justify-content': [
    'justifyContent',
    {
      ...FLEX_START_END,
      center: 'center',
      'space-between': 'space-between',
      'space-around': 'space-around',
      'space-evenly': 'space-evenly',
    },
  ],
  'align-items': [
    'alignItems',
    { ...FLEX_START_END, center: 'center', stretch: 'stretch', baseline: 'baseline' },
  ],
  'align-self': [
    'alignSelf',
    { ...FLEX_START_END, auto: 'auto', center: 'center', stretch: 'stretch', baseline: 'baseline' },
  ],
  'align-content': [
    'alignContent',
    {
      ...FLEX_START_END,
      center: 'center',
      stretch: 'stretch',
      'space-between': 'space-between',
      'space-around': 'space-around',
    },
  ],
  overflow: ['overflow', { visible: 'visible', hidden: 'hidden', scroll: 'scroll' }],
  'text-align': [
    'textAlign',
    {
      left: 'left',
      right: 'right',
      center: 'center',
      justify: 'justify',
      start: 'left',
      end: 'right',
    },
  ],
  'text-decoration-line': [
    'textDecorationLine',
    { none: 'none', underline: 'underline', 'line-through': 'line-through' },
  ],
}

// Declarations Tailwind adds next to the ones that matter (border-style: solid with border-2).
const SILENTLY_IGNORED = new Set(['border-style'])

function flex(value) {
  if (value === 'auto') return { flexGrow: 1, flexShrink: 1, flexBasis: 'auto' }
  if (value === 'none') return { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' }
  if (/^-?[\d.]+$/.test(value)) return { flex: Number(value) }

  const [grow, shrink, basis] = splitTopLevel(value, ' ')
  const flexBasis = basis === undefined ? undefined : dimension(basis)

  return {
    flexGrow: Number(grow),
    flexShrink: Number(shrink ?? 1),
    ...(flexBasis != null && { flexBasis }),
  }
}

function aspectRatio(value) {
  const [width, height = '1'] = value.split('/').map((part) => Number(part.trim()))

  return Number.isFinite(width / height) ? { aspectRatio: width / height } : null
}

function fontWeight(value) {
  if (value === 'normal' || value === 'bold') return { fontWeight: value }

  return /^[1-9]00$/.test(value) ? { fontWeight: value } : null
}

function rotate(value) {
  const angle = evaluateLength(value)

  return angle?.unit === 'deg' ? { transform: [{ rotate: `${finite(angle.number)}deg` }] } : null
}

function scale(value) {
  const [x, y = x] = splitTopLevel(value, ' ').map(fraction)
  if (x == null || y == null) return null

  return { transform: x === y ? [{ scale: x }] : [{ scaleX: x }, { scaleY: y }] }
}

function translate(value) {
  const [x, y = '0'] = splitTopLevel(value, ' ').map(points)
  if (x == null || y == null) return null

  return {
    transform: [{ translateX: x }, { translateY: y }].filter(
      (step) => Object.values(step)[0] !== 0,
    ),
  }
}

// shadow-md: the first visible layer of box-shadow (native views have one shadow).
function boxShadow(value) {
  const layers = splitTopLevel(value, ',').map((layer) => splitTopLevel(layer, ' '))
  const visibleLayers = layers
    .filter((parts) => !parts.includes('inset'))
    .map((parts) => ({
      lengths: parts.filter((part) => points(part) !== null).map(points),
      rgba: rgbaOf(parts.at(-1)),
    }))
    .filter(({ rgba }) => rgba && rgba.alpha > 0)

  if (visibleLayers.length === 0) return { shadowOpacity: 0 }

  // Limitation: Native views draw one shadow, without spread: the first layer, its blur halved to look alike;
  // stack shadow layers natively if richer shadows are wanted.
  const [{ lengths, rgba }] = visibleLayers
  const [offsetX = 0, offsetY = 0, blur = 0] = lengths

  return {
    shadowColor: hexColor({ ...rgba, alpha: 1 }),
    shadowOpacity: Math.round(rgba.alpha * 1000) / 1000,
    shadowRadius: blur / 2,
    shadowOffset: { width: offsetX, height: offsetY },
  }
}

const CONVERTERS = {
  flex,
  'flex-grow': (value) => ({ flexGrow: Number(value) }),
  'flex-shrink': (value) => ({ flexShrink: Number(value) }),
  'aspect-ratio': aspectRatio,
  'font-weight': fontWeight,
  opacity: (value) => {
    const opacity = fraction(value)
    return opacity === null ? null : { opacity }
  },
  rotate,
  scale,
  translate,
  'box-shadow': boxShadow,
}

/** The style for one declaration, or null when native views have nothing like it. */
export function convertDeclaration(property, value) {
  if (DIMENSION_PROPERTIES[property]) {
    const converted = dimension(value)
    return converted === null
      ? null
      : Object.fromEntries(DIMENSION_PROPERTIES[property].map((key) => [key, converted]))
  }
  if (POINT_PROPERTIES[property]) {
    const converted = points(value)
    return converted === null ? null : { [POINT_PROPERTIES[property]]: converted }
  }
  if (COLOR_PROPERTIES[property]) {
    const converted = color(value)
    return converted === null ? null : { [COLOR_PROPERTIES[property]]: converted }
  }
  if (KEYWORD_PROPERTIES[property]) {
    const [key, values] = KEYWORD_PROPERTIES[property]
    return values[value] ? { [key]: values[value] } : null
  }

  return CONVERTERS[property]?.(value) ?? null
}

// ---------- Stylesheet ----------

// The media queries of the variants native apps have: dark: is Tailwind's own, ios: and android:
// are declared by vite.mjs.
const CONDITION_BY_MEDIA_QUERY = {
  '(prefers-color-scheme: dark)': 'dark',
  '(nativue-platform: ios)': 'ios',
  '(nativue-platform: android)': 'android',
}

// conditions: those of the enclosing @media rules; null under one native apps don't have (hover:,
// md:) or a @supports fallback.
function* walk(items, conditions = []) {
  for (const item of items) {
    if (!item.children) continue

    yield { item, conditions }

    if (item.prelude.startsWith('@media')) {
      const condition = CONDITION_BY_MEDIA_QUERY[item.prelude.slice('@media'.length).trim()]
      yield* walk(item.children, conditions && condition ? [...conditions, condition] : null)
    } else {
      yield* walk(item.children, item.prelude.startsWith('@supports') ? null : conditions)
    }
  }
}

function declarations(item) {
  return item.children.filter((child) => !child.children)
}

/** Theme variables (:root), and @property initial values. */
function globalVariables(items) {
  const theme = new Map()
  const initialValues = new Map()

  for (const { item } of walk(items)) {
    if (item.prelude.startsWith('@property ')) {
      const initialValue = declarations(item).find((child) => child.property === 'initial-value')
      if (initialValue) initialValues.set(item.prelude.slice(10).trim(), initialValue.value)
    } else if (item.prelude.split(',').some((selector) => selector.trim() === ':root')) {
      for (const { property, value } of declarations(item)) theme.set(property, value)
    }
  }

  return {
    theme,
    initialValues,
    lookup: (name) => theme.get(name) ?? initialValues.get(name) ?? null,
  }
}

// ---------- Variables resolved at run time ----------

// Properties whose value can come from variables other utilities set on the same element
// (bg-linear-to-r with from-red-500 and to-green-500): kept with their var(), resolved per element at
// run time (runtime.ts), as CSS resolves them.
const RUN_TIME_PROPERTIES = { 'background-image': 'backgroundImage' }
const VARIABLE_REFERENCE = /var\(\s*(--[\w-]+)/g

/** The variables run-time properties read, directly or through other variables, the theme's left out. */
function runTimeVariableNames(items, theme) {
  const valuesByVariable = new Map()
  const pending = []

  for (const { item } of walk(items)) {
    if (item.prelude.startsWith('@')) continue

    for (const { property, value } of declarations(item)) {
      if (property.startsWith('--'))
        valuesByVariable.set(property, [...(valuesByVariable.get(property) ?? []), value])
      if (RUN_TIME_PROPERTIES[property]) pending.push(value)
    }
  }

  const names = new Set()

  while (pending.length > 0) {
    for (const [, name] of pending.pop().matchAll(VARIABLE_REFERENCE)) {
      if (names.has(name) || theme.has(name)) continue

      names.add(name)
      pending.push(...(valuesByVariable.get(name) ?? []))
    }
  }

  return names
}

/** var() of build-time variables replaced; run-time ones kept, with their fallback resolved. */
function resolveBuildTimeVariables(value, lookup, runTimeNames) {
  let result = ''
  let rest = value

  for (let start = rest.indexOf('var('); start !== -1; start = rest.indexOf('var(')) {
    const end = closingParenthesis(rest, start + 3)
    const [name, ...fallbackParts] = splitTopLevel(rest.slice(start + 4, end), ',')
    const variable = name.trim()
    const fallback = fallbackParts.length > 0 ? fallbackParts.join(',') : null

    if (runTimeNames.has(variable)) {
      const resolvedFallback =
        fallback === null ? '' : `, ${resolveBuildTimeVariables(fallback, lookup, runTimeNames)}`

      result += `${rest.slice(0, start)}var(${variable}${resolvedFallback})`
      rest = rest.slice(end + 1)
    } else {
      const replacement = lookup(variable) ?? fallback

      if (replacement === null) return null
      rest = rest.slice(0, start) + replacement + rest.slice(end + 1)
    }
  }

  return withHexColors(result + rest)
}

const COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix|color)\(/g

/** The color functions in a value (oklch from the theme...) as hex colors, which native reads. */
function withHexColors(value) {
  let result = ''
  let index = 0

  for (const match of value.matchAll(COLOR_FUNCTION)) {
    if (match.index < index) continue

    const end = closingParenthesis(value, match.index + match[0].length - 1)
    const text = value.slice(match.index, end + 1)

    result += value.slice(index, match.index) + (color(text) ?? text)
    index = end + 1
  }

  return result + value.slice(index)
}

function convertRule(rule, globalLookup, runTimeNames) {
  const ruleDeclarations = declarations(rule)
  const localVariables = new Map(
    ruleDeclarations
      .filter(({ property }) => property.startsWith('--'))
      .map(({ property, value }) => [property, value]),
  )
  const lookup = (name) => localVariables.get(name) ?? globalLookup(name)
  const buildTimeLookup = (name) => (runTimeNames.has(name) ? null : lookup(name))
  const style = {}
  const unsupported = []

  for (const { property, value } of ruleDeclarations) {
    if (runTimeNames.has(property)) {
      style[property] = resolveBuildTimeVariables(value, buildTimeLookup, runTimeNames)
      continue
    }
    if (property.startsWith('--') || SILENTLY_IGNORED.has(property)) continue
    if (RUN_TIME_PROPERTIES[property]) {
      const template = resolveBuildTimeVariables(value, buildTimeLookup, runTimeNames)

      if (template) style[RUN_TIME_PROPERTIES[property]] = template
      else unsupported.push(property)
      continue
    }

    const resolvedValue = resolveVariables(value.replace(/\s*!important$/, ''), lookup)
    const converted = resolvedValue === null ? null : convertDeclaration(property, resolvedValue)

    if (converted) Object.assign(style, converted)
    else unsupported.push(property)
  }

  return { style, unsupported }
}

/**
 * The styles of every utility in `css`, keyed by class name: [order, style] or, for variants,
 * [order, style, conditions] ('dark', 'pressed', 'focused', 'disabled', 'ios', 'android', all of
 * which must hold). order is the rule's place in the stylesheet: later rules win, as in CSS.
 * A style can hold variables ('--tw-gradient-from') and a backgroundImage reading them, resolved per
 * element at run time, with `variables` (their initial values) for those no class sets.
 * `ignored` explains the classes that produced nothing.
 */
export function stylesFromCss(css) {
  const { items } = parseBlock(stripComments(css))
  const { theme, initialValues, lookup: globalLookup } = globalVariables(items)
  const runTimeNames = runTimeVariableNames(items, theme)
  const variables = Object.fromEntries(
    [...runTimeNames]
      .filter((name) => initialValues.has(name))
      .map((name) => [name, withHexColors(initialValues.get(name))]),
  )
  const styles = {}
  const ignored = {}
  let order = 0

  for (const { item, conditions } of walk(items)) {
    if (item.prelude.startsWith('@')) continue

    const utility = utilitySelector(item.prelude)
    if (!utility || !conditions) {
      const ruleClassName = utilityClassName(item.prelude)
      if (ruleClassName)
        ignored[ruleClassName] =
          'only dark:, active:, focus:, disabled:, ios: and android: variants are supported, and no child selectors'
      continue
    }

    const { style, unsupported } = convertRule(item, globalLookup, runTimeNames)
    const ruleConditions = [...conditions, ...utility.states]

    if (Object.keys(style).length === 0) {
      ignored[utility.className] = `${unsupported.join(', ') || 'nothing'} has no native equivalent`
    } else {
      styles[utility.className] =
        ruleConditions.length > 0 ? [order++, style, ruleConditions] : [order++, style]
    }
  }

  for (const className of Object.keys(styles)) delete ignored[className]

  return { styles, variables, ignored }
}
