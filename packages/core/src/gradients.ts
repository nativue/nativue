// backgroundImage, as CSS writes it: linear-gradient() and radial-gradient(), one or several (the first
// on top), parsed into what native draws over backgroundColor. The geometry that depends on the view's
// size (an angle's line, a corner, a radius) is worked out natively, at layout.
import { parseColor } from './colors'

/** A length: a fraction of the view's side plus points, [fraction, points]. */
type Length = [fraction: number, points: number]

export type BackgroundGradient = {
  type: 'linear' | 'radial'
  /** linear: degrees, 0 pointing up and 90 right; or the side or corner it goes to, e.g. ['top', 'right']. */
  angle?: number
  to?: string[]
  /** radial: a circle or an ellipse, sized by an extent keyword or by radii, around `center`. */
  shape?: 'circle' | 'ellipse'
  extent?: 'closest-side' | 'closest-corner' | 'farthest-side' | 'farthest-corner'
  radii?: [Length, Length]
  center?: [Length, Length]
  colors: number[]
  /** Fractions of the gradient line, one per color. */
  positions: number[]
}

const EXTENTS = new Set(['closest-side', 'closest-corner', 'farthest-side', 'farthest-corner'])
const SIDE_FRACTIONS: Record<string, number> = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 }
const DEGREES_PER_UNIT: Record<string, number> = {
  deg: 1,
  grad: 0.9,
  rad: 180 / Math.PI,
  turn: 360,
}

/** 'linear-gradient(135deg, #4af2ae, #10b39b)' as gradients native draws; [] for what it can't. */
export function processBackgroundImage(value: unknown): BackgroundGradient[] {
  if (typeof value !== 'string') return []

  return splitTopLevel(value, ',').flatMap((layer) => {
    const gradient = parseGradient(layer.trim())

    return gradient ? [gradient] : []
  })
}

function parseGradient(text: string): BackgroundGradient | null {
  const match = /^(linear|radial)-gradient\(([\s\S]*)\)$/i.exec(text)
  if (!match) return null

  const type = match[1].toLowerCase() as BackgroundGradient['type']
  const [first, ...rest] = splitTopLevel(match[2], ',').map((part) => part.trim())
  const firstTokens = splitTopLevel(first ?? '', ' ')
  const hasSettings = firstTokens.length > 0 && parseColor(firstTokens[0]) == null
  const stops = colorStops(hasSettings ? rest : [first, ...rest])
  if (stops.colors.length === 0) return null

  const settings = hasSettings
    ? withoutColorSpace(firstTokens.map((token) => token.toLowerCase()))
    : []

  return type === 'linear'
    ? { type, ...linearSettings(settings), ...stops }
    : { type, ...radialSettings(settings), ...stops }
}

const HUE_METHODS = new Set(['shorter', 'longer', 'increasing', 'decreasing'])

/** "in oklab", "in hsl longer hue", before or after the direction: left out, colors mix in sRGB. */
function withoutColorSpace(tokens: string[]): string[] {
  const start = tokens.indexOf('in')
  if (start < 0) return tokens

  const hasHueMethod = HUE_METHODS.has(tokens[start + 2]) && tokens[start + 3] === 'hue'

  return [...tokens.slice(0, start), ...tokens.slice(start + (hasHueMethod ? 4 : 2))]
}

/** "135deg", "to top right". */
function linearSettings(tokens: string[]): Pick<BackgroundGradient, 'angle' | 'to'> {
  if (tokens[0] === 'to') return { to: tokens.slice(1) }

  const angle = /^(-?[\d.]+)(deg|grad|rad|turn)?$/.exec(tokens[0] ?? '')

  return { angle: angle ? Number(angle[1]) * DEGREES_PER_UNIT[angle[2] ?? 'deg'] : 180 }
}

/** "circle at 30% 40%", "ellipse farthest-corner", "40px 20px at top left". */
function radialSettings(tokens: string[]): Partial<BackgroundGradient> {
  const atIndex = tokens.indexOf('at')
  const before = atIndex < 0 ? tokens : tokens.slice(0, atIndex)
  const sizes = before.filter((token) => /^-?[\d.]/.test(token)).map(length)
  const shape = before.includes('circle') || (sizes.length === 1 && !before.includes('ellipse'))
  const extent = before.find((token) => EXTENTS.has(token)) as BackgroundGradient['extent']

  return {
    shape: shape ? 'circle' : 'ellipse',
    ...(sizes.length > 0
      ? { radii: [sizes[0], sizes[1] ?? sizes[0]] }
      : { extent: extent ?? 'farthest-corner' }),
    center: position(atIndex < 0 ? [] : tokens.slice(atIndex + 1)),
  }
}

const HORIZONTAL = new Set(['left', 'right'])
const VERTICAL = new Set(['top', 'bottom'])

/**
 * "at top", "at center left", "at 30% 40px", "at right 10px top 20%": x and y, a keyword naming its
 * axis whatever the order, the one left out centered.
 */
function position(tokens: string[]): [Length, Length] {
  const isOffset = (token: string | undefined) => token !== undefined && /^-?[\d.]/.test(token)
  const hasEdgeOffsets = tokens.some(
    (token, index) => !isOffset(token) && token !== 'center' && isOffset(tokens[index + 1]),
  )

  // Edges and offsets from them: "right 10px top 20%".
  if (hasEdgeOffsets) {
    let x: Length = [0.5, 0]
    let y: Length = [0.5, 0]

    tokens.forEach((token, index) => {
      if (isOffset(token)) return

      const [fraction, points] = isOffset(tokens[index + 1]) ? length(tokens[index + 1]) : [0, 0]
      const fromEnd = token === 'right' || token === 'bottom'
      const edge: Length = fromEnd ? [1 - fraction, -points] : [fraction, points]

      if (HORIZONTAL.has(token)) x = edge
      else if (VERTICAL.has(token)) y = edge
    })

    return [x, y]
  }

  const [first, second = 'center'] = tokens
  if (first === undefined)
    return [
      [0.5, 0],
      [0.5, 0],
    ]

  const isSwapped = VERTICAL.has(first) || HORIZONTAL.has(second)

  return isSwapped ? [length(second), length(first)] : [length(first), length(second)]
}

function length(token: string): Length {
  if (token in SIDE_FRACTIONS) return [SIDE_FRACTIONS[token], 0]
  if (token.endsWith('%')) return [Number.parseFloat(token) / 100, 0]

  return [0, Number.parseFloat(token) || 0]
}

/**
 * "red", "red 20%", "red 20% 40%" (two stops): colors and their positions, missing ones spread evenly
 * between their neighbours, as CSS places them. Positions are percentages; a length counts as missing.
 */
function colorStops(parts: string[]): Pick<BackgroundGradient, 'colors' | 'positions'> {
  const colors: number[] = []
  const known: (number | undefined)[] = []

  for (const part of parts) {
    const [colorText, ...positions] = splitTopLevel(part, ' ')
    // A color hint ("red, 30%, blue") is left out: colors mix evenly.
    const color = parseColor(colorText)
    if (color == null) continue

    const fractions = positions.map((text) =>
      text.endsWith('%') ? Number.parseFloat(text) / 100 : undefined,
    )

    for (const fraction of fractions.length > 0 ? fractions : [undefined]) {
      colors.push(color)
      known.push(fraction)
    }
  }
  if (colors.length === 1) {
    colors.push(colors[0])
    known.push(undefined)
  }

  return withoutTransparentBlack(...withinLine(colors, spreadPositions(known)))
}

/**
 * Stops before 0% or past 100%, which CSS allows, cut at the ends of the line, the colors there mixed
 * from their neighbours: native gradients take positions from 0 to 1.
 */
function withinLine(colors: number[], positions: number[]): [number[], number[]] {
  if (positions[0] >= 0 && positions[positions.length - 1] <= 1) return [colors, positions]

  const colorAt = (position: number) => {
    const after = positions.findIndex((stop) => stop >= position)
    if (after <= 0) return colors[after < 0 ? colors.length - 1 : 0]

    const span = positions[after] - positions[after - 1]

    return mixColors(
      colors[after - 1],
      colors[after],
      span === 0 ? 1 : (position - positions[after - 1]) / span,
    )
  }
  const inside = positions.flatMap((position, index) =>
    position > 0 && position < 1 ? [index] : [],
  )

  return [
    [colorAt(0), ...inside.map((index) => colors[index]), colorAt(1)],
    [0, ...inside.map((index) => positions[index]), 1],
  ]
}

/** Two 0xRRGGBBAA colors mixed, `amount` of the way from the first. */
function mixColors(first: number, second: number, amount: number): number {
  const channel = (color: number, shift: number) => (color >>> shift) & 0xff
  const mixed = [24, 16, 8, 0].map((shift) =>
    Math.round(channel(first, shift) + (channel(second, shift) - channel(first, shift)) * amount),
  )

  return ((mixed[0] << 24) | (mixed[1] << 16) | (mixed[2] << 8) | mixed[3]) >>> 0
}

/**
 * CSS mixes a gradient's colors premultiplied: orange to transparent fades the orange out. Native mixes
 * them as they are, through transparent's black, so a fully transparent stop takes its neighbours' color
 * (twice, at the same place, when they differ).
 */
function withoutTransparentBlack(
  colors: number[],
  positions: number[],
): Pick<BackgroundGradient, 'colors' | 'positions'> {
  const result: Pick<BackgroundGradient, 'colors' | 'positions'> = { colors: [], positions: [] }
  const isClear = (color: number) => (color & 0xff) === 0
  const add = (color: number, position: number) => {
    result.colors.push(color >>> 0)
    result.positions.push(position)
  }

  colors.forEach((color, index) => {
    if (!isClear(color)) return add(color, positions[index])

    const neighbours = [colors[index - 1], colors[index + 1]].filter(
      (neighbour) => neighbour !== undefined && !isClear(neighbour),
    )
    if (neighbours.length === 0) return add(color, positions[index])

    for (const neighbour of new Set(neighbours)) add(neighbour & 0xffffff00, positions[index])
  })

  return result
}

function spreadPositions(known: (number | undefined)[]): number[] {
  const positions = [...known]

  positions[0] ??= 0
  positions[positions.length - 1] ??= 1

  // Never before an earlier stop.
  let latest = positions[0]!

  for (let index = 1; index < positions.length; index++) {
    if (positions[index] === undefined) continue

    positions[index] = Math.max(positions[index]!, latest)
    latest = positions[index]!
  }
  for (let index = 1; index < positions.length; index++) {
    if (positions[index] !== undefined) continue

    const next = positions.findIndex((position, after) => after > index && position !== undefined)
    const start = positions[index - 1]!
    const step = (positions[next]! - start) / (next - index + 1)

    for (let missing = index; missing < next; missing++)
      positions[missing] = start + step * (missing - index + 1)
  }

  return positions as number[]
}

/** Splits on `separator` outside parentheses: "rgb(0, 0, 0) 10%, red" by ",". */
function splitTopLevel(text: string, separator: ',' | ' '): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''

  for (const character of text) {
    if (character === '(') depth++
    if (character === ')') depth--

    const separates = separator === ' ' ? /\s/.test(character) : character === separator

    if (separates && depth === 0) {
      if (current.trim()) parts.push(current.trim())
      current = ''
    } else {
      current += character
    }
  }
  if (current.trim()) parts.push(current.trim())

  return parts
}
