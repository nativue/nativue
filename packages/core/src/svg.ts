// <svg> as on the web: the root is one native view, and what's inside it stays in JS. Each change
// sends the native view the whole drawing, [tag, attributes, children], in one go.
import { processColor } from './colors'

export interface SvgNode {
  id: number
  type: string
  parent: SvgNode | null
  children: SvgNode[]
  text: string
  svgAttributes?: Record<string, unknown>
}

export type DrawingElement = [
  tag: string,
  attributes: Record<string, unknown>,
  children: DrawingElement[] | string,
]

// The native view's tag; <svg> and <Svg> both create it.
export const SVG_ROOT = 'Svg'

const PART_TAGS = [
  'g',
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'defs',
  'linearGradient',
  'radialGradient',
  'stop',
]
const PART_TAG_SET = new Set(PART_TAGS)

/**
 * The elements as components, <Path> for <path>: global, so an app's own component of the same name
 * (imported, or registered) still wins. <Text> is nativue's text: an SVG's is <SvgText>.
 */
export const SVG_COMPONENTS: Record<string, string> = Object.fromEntries(
  PART_TAGS.map((tag) => [tag === 'text' ? 'SvgText' : tag[0].toUpperCase() + tag.slice(1), tag]),
)

// SVG keeps these camelCase; the rest is written kebab-case (stroke-width), whatever the template used.
const CAMEL_CASE_ATTRIBUTES = new Set([
  'viewBox',
  'preserveAspectRatio',
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
])
const COLOR_ATTRIBUTES = new Set(['fill', 'stroke', 'stop-color', 'color'])
const STRING_ATTRIBUTES = new Set([
  'd',
  'points',
  'id',
  'font-family',
  'font-weight',
  'text-anchor',
  'stroke-linecap',
  'stroke-linejoin',
  'fill-rule',
  'gradientUnits',
  'spreadMethod',
  'preserveAspectRatio',
])
// Gradients and their stops use fractions (objectBoundingBox): "50%" is 0.5 there.
const FRACTION_TAGS = new Set(['linearGradient', 'radialGradient', 'stop'])
// Elsewhere a percentage is of the viewBox: of its width, its height, or its normalized diagonal.
const WIDTH_ATTRIBUTES = new Set(['x', 'cx', 'rx', 'width', 'x1', 'x2', 'dx'])
const HEIGHT_ATTRIBUTES = new Set(['y', 'cy', 'ry', 'height', 'y1', 'y2', 'dy'])

type Viewport = { width: number; height: number }

/** 'path' for <path>; null for anything that isn't inside an SVG. */
export function svgPartTag(type: string): string | null {
  return PART_TAG_SET.has(type) ? type : null
}

export function isSvgRoot(type: string): boolean {
  return type === 'svg' || type === SVG_ROOT
}

export function svgRootOf(node: SvgNode | null): SvgNode | null {
  let current = node

  while (current && !isSvgRoot(current.type)) current = current.parent

  return current
}

export function attributeName(key: string): string {
  const camelCased = key.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase())

  if (CAMEL_CASE_ATTRIBUTES.has(camelCased)) return camelCased

  return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}

/** "translate(10 20) rotate(45)" as one matrix, [a, b, c, d, e, f]. */
export function transformMatrix(transform: string): number[] {
  let matrix = [1, 0, 0, 1, 0, 0]

  for (const [, name, values] of transform.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const numbers = values
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number)
    matrix = multiply(matrix, functionMatrix(name, numbers))
  }

  return matrix
}

function functionMatrix(name: string, [first = 0, second, third, ...rest]: number[]): number[] {
  const radians = (first * Math.PI) / 180

  switch (name) {
    case 'translate':
      return [1, 0, 0, 1, first, second ?? 0]
    case 'scale':
      return [first, 0, 0, second ?? first, 0, 0]
    case 'rotate': {
      const rotation = [
        Math.cos(radians),
        Math.sin(radians),
        -Math.sin(radians),
        Math.cos(radians),
        0,
        0,
      ]
      if (second === undefined) return rotation

      const toCenter = [1, 0, 0, 1, second, third ?? 0]
      const fromCenter = [1, 0, 0, 1, -second, -(third ?? 0)]

      return multiply(multiply(toCenter, rotation), fromCenter)
    }
    case 'skewX':
      return [1, 0, Math.tan(radians), 1, 0, 0]
    case 'skewY':
      return [1, Math.tan(radians), 0, 1, 0, 0]
    case 'matrix':
      return [first, second ?? 0, third ?? 0, ...rest, 0, 0, 0].slice(0, 6)
    default:
      return [1, 0, 0, 1, 0, 0]
  }
}

function multiply([a, b, c, d, e, f]: number[], [g, h, i, j, k, l]: number[]): number[] {
  return [
    a * g + c * h,
    b * g + d * h,
    a * i + c * j,
    b * i + d * j,
    a * k + c * l + e,
    b * k + d * l + f,
  ]
}

/** "12" and "12px" as numbers; "50%" stays, resolved when the drawing is made. */
function numberValue(value: unknown): unknown {
  if (typeof value !== 'string') return value

  const trimmed = value.trim()
  if (trimmed.endsWith('%')) return trimmed

  const number = Number.parseFloat(trimmed)

  return Number.isNaN(number) ? trimmed : number
}

/** [name, value] the native drawing reads, or null to leave it out. */
export function drawingAttribute(key: string, value: unknown): [string, unknown] | null {
  if (value == null || value === false) return null

  const name = attributeName(key)

  if (name === 'viewBox') {
    return [
      name,
      Array.isArray(value)
        ? value
        : String(value)
            .trim()
            .split(/[\s,]+/)
            .map(Number),
    ]
  }
  if (name === 'transform' || name === 'gradientTransform')
    return [name, transformMatrix(String(value))]
  if (name === 'stroke-dasharray') {
    return value === 'none'
      ? null
      : [
          name,
          String(value)
            .split(/[\s,]+/)
            .filter(Boolean)
            .map(Number),
        ]
  }
  if (COLOR_ATTRIBUTES.has(name)) return [name, colorValue(value)]
  if (STRING_ATTRIBUTES.has(name)) return [name, String(value)]

  return [name, numberValue(value)]
}

/** none, currentColor and url(#id) as they are; any other color as 0xRRGGBBAA. */
function colorValue(value: unknown): unknown {
  const text = String(value).trim()

  if (text === 'none' || text === 'currentColor' || text.startsWith('url(')) return text

  return processColor(text) ?? 'none'
}

/** The drawing the native view gets: the root's attributes, then its children. */
export function drawingOf(root: SvgNode, isPressable: (node: SvgNode) => boolean): DrawingElement {
  const attributes: Record<string, unknown> = { ...root.svgAttributes }
  const viewport = viewportOf(attributes)

  if (isPressable(root)) attributes.nodeId = root.id

  return [
    'svg',
    attributes,
    root.children.flatMap((child) => elementsOf(child, isPressable, viewport)),
  ]
}

/** What percentages are of: the viewBox, or the size the width and height attributes give. */
function viewportOf(attributes: Record<string, unknown>): Viewport {
  const viewBox = attributes.viewBox as number[] | undefined
  if (viewBox?.length === 4) return { width: viewBox[2], height: viewBox[3] }

  return { width: Number(attributes.width) || 0, height: Number(attributes.height) || 0 }
}

function elementsOf(
  node: SvgNode,
  isPressable: (node: SvgNode) => boolean,
  viewport: Viewport,
): DrawingElement[] {
  const tag = svgPartTag(node.type)
  if (!tag) return []

  const attributes = resolvedPercentages(tag, { ...node.svgAttributes }, viewport)
  if (isPressable(node)) attributes.nodeId = node.id

  // <text>'s content is its text, <tspan>s included, with whitespace collapsed as in SVG.
  if (tag === 'text') return [[tag, attributes, textOf(node).replace(/\s+/g, ' ').trim()]]

  const children = node.children.flatMap((child) => elementsOf(child, isPressable, viewport))

  return [[tag, attributes, children]]
}

function resolvedPercentages(tag: string, attributes: Record<string, unknown>, viewport: Viewport) {
  const diagonal = Math.hypot(viewport.width, viewport.height) / Math.SQRT2

  for (const [name, value] of Object.entries(attributes)) {
    if (typeof value !== 'string' || !value.endsWith('%')) continue

    const fraction = Number.parseFloat(value) / 100

    if (FRACTION_TAGS.has(tag)) attributes[name] = fraction
    else if (WIDTH_ATTRIBUTES.has(name)) attributes[name] = fraction * viewport.width
    else if (HEIGHT_ATTRIBUTES.has(name)) attributes[name] = fraction * viewport.height
    else attributes[name] = fraction * diagonal
  }

  return attributes
}

function textOf(node: SvgNode): string {
  return node.children
    .map((child) => (child.type === '#text' ? child.text : textOf(child)))
    .join('')
}
