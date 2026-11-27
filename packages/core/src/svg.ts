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
  /** Its style attribute (style="fill: red"), over the attributes, as CSS is. */
  svgStyleAttributes?: Record<string, unknown>
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
  'use',
  'symbol',
  'clipPath',
  'mask',
  'filter',
  'feDropShadow',
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
  'clipPathUnits',
  'maskUnits',
  'maskContentUnits',
  'stdDeviation',
])
const COLOR_ATTRIBUTES = new Set(['fill', 'stroke', 'stop-color', 'color', 'flood-color'])
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
  'href',
  'xlink:href',
  'clip-path',
  'clip-rule',
  'mask',
  'filter',
  'clipPathUnits',
  'maskUnits',
  'maskContentUnits',
])
// Nested <use>s stop here, so one that refers to itself can't loop.
const MAXIMUM_USE_DEPTH = 8
// Gradients and their stops use fractions (objectBoundingBox): "50%" is 0.5 there.
const FRACTION_TAGS = new Set(['linearGradient', 'radialGradient', 'stop'])
// Elsewhere a percentage is of the viewBox: of its width, its height, or its normalized diagonal.
const WIDTH_ATTRIBUTES = new Set(['x', 'cx', 'rx', 'width', 'x1', 'x2', 'dx', 'fx'])
const HEIGHT_ATTRIBUTES = new Set(['y', 'cy', 'ry', 'height', 'y1', 'y2', 'dy', 'fy'])
// Opacities are fractions anywhere: "50%" is 0.5.
const OPACITY_ATTRIBUTES = new Set([
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'stop-opacity',
  'flood-opacity',
])

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
  if (COLOR_ATTRIBUTES.has(name)) {
    const color = colorValue(value)

    return color === undefined ? null : [name, color]
  }
  if (STRING_ATTRIBUTES.has(name)) return [name, String(value)]

  return [name, numberValue(value)]
}

/**
 * none, currentColor and url(#id) as they are; any other color as 0xRRGGBBAA. undefined for inherit and
 * colors it can't read: left out, the parent's paint applies, as in SVG.
 */
function colorValue(value: unknown): unknown {
  const text = String(value).trim()

  if (text === 'none' || text === 'currentColor' || text.startsWith('url(')) return text
  if (text === 'inherit') return undefined

  return processColor(text) ?? undefined
}

/** style="fill: red; stroke-width: 2" (or Vue's object for it) as drawing attributes. */
export function styleAttributes(style: unknown): Record<string, unknown> {
  const declarations =
    typeof style === 'string'
      ? style.split(';').map((declaration) => declaration.split(':').map((part) => part.trim()))
      : Object.entries((style ?? {}) as Record<string, unknown>)
  const attributes: Record<string, unknown> = {}

  for (const [property, value] of declarations) {
    const attribute = property ? drawingAttribute(String(property), value) : null
    if (attribute) attributes[attribute[0]] = attribute[1]
  }

  return attributes
}

type DrawingContext = {
  isPressable: (node: SvgNode) => boolean
  viewport: Viewport
  nodesById: Map<string, SvgNode>
  useDepth: number
}

/** The drawing the native view gets: the root's attributes, then its children. */
export function drawingOf(root: SvgNode, isPressable: (node: SvgNode) => boolean): DrawingElement {
  const attributes: Record<string, unknown> = { ...root.svgAttributes }
  const nodesById = new Map<string, SvgNode>()
  const context = { isPressable, viewport: viewportOf(attributes), nodesById, useDepth: 0 }

  indexById(root, nodesById)
  applyFilter(attributes, context)
  if (isPressable(root)) attributes.nodeId = root.id

  return ['svg', attributes, root.children.flatMap((child) => elementsOf(child, context))]
}

function indexById(node: SvgNode, nodesById: Map<string, SvgNode>) {
  const id = node.svgAttributes?.id

  if (typeof id === 'string' && !nodesById.has(id)) nodesById.set(id, node)
  node.children.forEach((child) => indexById(child, nodesById))
}

/** What percentages are of: the viewBox, or the size the width and height attributes give. */
function viewportOf(attributes: Record<string, unknown>): Viewport {
  const viewBox = attributes.viewBox as number[] | undefined
  if (viewBox?.length === 4) return { width: viewBox[2], height: viewBox[3] }

  return { width: Number(attributes.width) || 0, height: Number(attributes.height) || 0 }
}

function attributesOf(node: SvgNode): Record<string, unknown> {
  return { ...node.svgAttributes, ...node.svgStyleAttributes }
}

/** The element an href ("#id") or url(#id) refers to. */
function referenced(reference: unknown, context: DrawingContext): SvgNode | undefined {
  const id = String(reference ?? '').match(/#([^)\s]+)/)?.[1]

  return id === undefined ? undefined : context.nodesById.get(id)
}

function elementsOf(node: SvgNode, context: DrawingContext): DrawingElement[] {
  const tag = svgPartTag(node.type)
  if (!tag) return []
  if (tag === 'use') return useElements(node, context)

  const attributes = resolvedPercentages(tag, attributesOf(node), context.viewport)
  let children = node.children.flatMap((child) => elementsOf(child, context))

  if (context.isPressable(node)) attributes.nodeId = node.id
  applyFilter(attributes, context)
  // A gradient's href lends it the attributes it doesn't set, and its stops when it has none.
  if (tag === 'linearGradient' || tag === 'radialGradient') {
    const inherited = referenced(attributes.href ?? attributes['xlink:href'], context)

    if (inherited) {
      const inheritedAttributes = resolvedPercentages(
        tag,
        attributesOf(inherited),
        context.viewport,
      )

      Object.assign(attributes, { ...inheritedAttributes, ...attributes })
      if (!children.some(([childTag]) => childTag === 'stop')) {
        children = inherited.children.flatMap((child) => elementsOf(child, context))
      }
    }
  }
  if (tag === 'text') return [[tag, attributes, textRuns(node, context)]]

  return [[tag, attributes, children]]
}

/**
 * <use href="#id" x y>: a copy of the element, moved by x and y. A <symbol> is fitted into its width
 * and height, as its viewBox says.
 */
function useElements(node: SvgNode, context: DrawingContext): DrawingElement[] {
  const attributes = resolvedPercentages('use', attributesOf(node), context.viewport)
  const target = referenced(attributes.href ?? attributes['xlink:href'], context)
  if (!target || context.useDepth >= MAXIMUM_USE_DEPTH) return []

  const nested = { ...context, useDepth: context.useDepth + 1 }
  const placement = [1, 0, 0, 1, Number(attributes.x) || 0, Number(attributes.y) || 0]
  const transform = multiply((attributes.transform as number[]) ?? [1, 0, 0, 1, 0, 0], placement)
  const content =
    target.type === 'symbol'
      ? [
          [
            'g',
            { transform: symbolFit(target, attributes) },
            target.children.flatMap((child) => elementsOf(child, nested)),
          ] as DrawingElement,
        ]
      : elementsOf(target, nested)

  for (const name of ['href', 'xlink:href', 'x', 'y', 'width', 'height']) delete attributes[name]
  applyFilter(attributes, context)
  if (context.isPressable(node)) attributes.nodeId = node.id

  return [['g', { ...attributes, transform }, content]]
}

/** A <symbol>'s viewBox fitted into the <use>'s width and height, centered (xMidYMid meet). */
function symbolFit(symbol: SvgNode, useAttributes: Record<string, unknown>): number[] {
  const viewBox = symbol.svgAttributes?.viewBox as number[] | undefined
  if (viewBox?.length !== 4 || !viewBox[2] || !viewBox[3]) return [1, 0, 0, 1, 0, 0]

  const width = Number(useAttributes.width ?? symbol.svgAttributes?.width) || viewBox[2]
  const height = Number(useAttributes.height ?? symbol.svgAttributes?.height) || viewBox[3]
  const scale = Math.min(width / viewBox[2], height / viewBox[3])

  return [
    scale,
    0,
    0,
    scale,
    (width - viewBox[2] * scale) / 2 - viewBox[0] * scale,
    (height - viewBox[3] * scale) / 2 - viewBox[1] * scale,
  ]
}

/** filter="url(#id)" in place: what native draws, a shadow. */
function applyFilter(attributes: Record<string, unknown>, context: DrawingContext) {
  if (!attributes.filter) return

  Object.assign(attributes, shadowOf(referenced(attributes.filter, context)))
  delete attributes.filter
}

/** filter="url(#id)" with an <feDropShadow>: a shadow, [dx, dy, blur, color]. Other filters draw nothing. */
function shadowOf(filter: SvgNode | undefined): Record<string, unknown> {
  const dropShadow = filter?.children.find((child) => child.type === 'feDropShadow')
  if (!dropShadow) return {}

  const attributes = attributesOf(dropShadow)
  const color =
    typeof attributes['flood-color'] === 'number' ? attributes['flood-color'] : 0x000000ff
  const opacity = Number(attributes['flood-opacity'] ?? 1)
  const alpha = Math.round((color & 0xff) * opacity)

  return {
    shadow: [
      Number(attributes.dx ?? 2),
      Number(attributes.dy ?? 2),
      Number(attributes.stdDeviation ?? 2),
      ((color & 0xffffff00) | alpha) >>> 0,
    ],
  }
}

/**
 * <text>'s runs: its text and its <tspan>s, each with its own position (x, y, dx, dy) and style, whitespace
 * collapsed as in SVG.
 */
function textRuns(node: SvgNode, context: DrawingContext): DrawingElement[] {
  const runs: DrawingElement[] = node.children.flatMap((child): DrawingElement[] => {
    if (child.type === '#text') return [['tspan', {}, child.text]]
    if (child.type !== 'tspan') return []

    const attributes = resolvedPercentages('tspan', attributesOf(child), context.viewport)

    return [['tspan', attributes, textOf(child)]]
  })
  let endsWithSpace = true

  for (const run of runs) {
    let text = (run[2] as string).replace(/\s+/g, ' ')

    if (endsWithSpace) text = text.trimStart()
    endsWithSpace = text.endsWith(' ') || (endsWithSpace && text === '')
    run[2] = text
  }

  const last = runs.findLast((run) => run[2] !== '')
  if (last) last[2] = (last[2] as string).trimEnd()

  return runs.filter((run) => run[2] !== '')
}

function resolvedPercentages(tag: string, attributes: Record<string, unknown>, viewport: Viewport) {
  const diagonal = Math.hypot(viewport.width, viewport.height) / Math.SQRT2

  for (const [name, value] of Object.entries(attributes)) {
    if (typeof value !== 'string' || !value.endsWith('%')) continue

    const fraction = Number.parseFloat(value) / 100
    // A gradient in the drawing's units (userSpaceOnUse) takes percentages of the viewport, as shapes do.
    const isFraction =
      OPACITY_ATTRIBUTES.has(name) ||
      tag === 'stop' ||
      (FRACTION_TAGS.has(tag) && attributes.gradientUnits !== 'userSpaceOnUse')

    if (isFraction) attributes[name] = fraction
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
