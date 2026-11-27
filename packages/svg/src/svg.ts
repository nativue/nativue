// <svg> as on the web: the root is one native view, and what's inside it stays in JS. Each batch of
// changes sends the native view the whole drawing, [tag, attributes, children], in one go.
import { processColor } from '@nativue/core'

export interface SvgNode {
  id: number
  type: string
  parent: SvgNode | null
  children: SvgNode[]
  text: string
  svgAttributes?: Record<string, unknown>
  /** What a <style> inside the <svg> gives it (vite.mjs): over its attributes, under its style. */
  svgCssAttributes?: Record<string, unknown>
  /** Its style attribute (style="fill: red"), over the attributes, as CSS is. */
  svgStyleAttributes?: Record<string, unknown>
}

export type DrawingElement = [
  tag: string,
  attributes: Record<string, unknown>,
  children: DrawingElement[] | string,
]

export const PART_TAGS = [
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
  'feGaussianBlur',
  'feOffset',
  'feFlood',
  'feColorMatrix',
  'feComposite',
  'feBlend',
  'feMerge',
  'feMergeNode',
  'image',
  'pattern',
  'marker',
  'textPath',
  'a',
  'title',
  'desc',
  'metadata',
]
const PART_TAG_SET = new Set(PART_TAGS)
// Never drawn where they are: referred to by id, or there for screen readers and tools.
const UNDRAWN_TAGS = new Set(['marker', 'filter', 'title', 'desc', 'metadata'])

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
  'patternUnits',
  'patternContentUnits',
  'patternTransform',
  'markerWidth',
  'markerHeight',
  'markerUnits',
  'refX',
  'refY',
  'startOffset',
])
const MATRIX_ATTRIBUTES = new Set(['transform', 'gradientTransform', 'patternTransform'])
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
  'patternUnits',
  'patternContentUnits',
  'markerUnits',
  'orient',
  'marker-start',
  'marker-mid',
  'marker-end',
  'marker',
  'display',
  'dominant-baseline',
  'alignment-baseline',
  'stdDeviation',
  'in',
  'in2',
  'type',
  'values',
  'operator',
  'visibility',
  'mask-type',
  'paint-order',
  'vector-effect',
  'font-style',
  'text-decoration',
])
// Absolute units in user units (CSS pixels); em and ex are resolved with the font size.
const PIXELS_PER_UNIT: Record<string, number> = {
  px: 1,
  pt: 4 / 3,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
}
// Drawn things a hidden visibility leaves out; a group's children decide for themselves.
const VISIBLE_TAGS = new Set([
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
  'text',
  'image',
])
// Nested <use>s stop here, so one that refers to itself can't loop.
const MAXIMUM_USE_DEPTH = 8
// Gradients and patterns are in the shape's box (objectBoundingBox) unless their units say otherwise:
// "50%" is 0.5 there.
const UNITS_ATTRIBUTE_BY_TAG: Record<string, string> = {
  linearGradient: 'gradientUnits',
  radialGradient: 'gradientUnits',
  pattern: 'patternUnits',
}
// Of the path's length, which only native knows.
const NATIVE_PERCENTAGE_ATTRIBUTES = new Set(['startOffset'])
const IDENTITY = [1, 0, 0, 1, 0, 0]
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

/** "12", "12px" and "9pt" as numbers; "50%" and "1.5em" stay, resolved when the drawing is made. */
function numberValue(value: unknown): unknown {
  if (typeof value !== 'string') return value

  const trimmed = value.trim()
  const unit = /[a-z%]*$/i.exec(trimmed)?.[0].toLowerCase() ?? ''
  if (unit === '%' || unit === 'em' || unit === 'ex') return trimmed

  const number = Number.parseFloat(trimmed)

  return Number.isNaN(number) ? trimmed : number * (PIXELS_PER_UNIT[unit] ?? 1)
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
  if (MATRIX_ATTRIBUTES.has(name)) return [name, transformMatrix(String(value))]
  // An imported image, or { uri }, as <Image>'s source takes it.
  if ((name === 'href' || name === 'xlink:href') && typeof value === 'object') {
    const uri = (value as { uri?: unknown }).uri

    return uri == null ? null : [name, String(uri)]
  }
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
  /** Inherited: 'hidden' leaves out what's drawn, unless it says 'visible'. */
  visibility?: unknown
}

/** The drawing the native view gets: the root's attributes, then its children. */
export function drawingOf(root: SvgNode, isPressable: (node: SvgNode) => boolean): DrawingElement {
  const attributes = attributesOf(root)
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
  return { ...node.svgAttributes, ...node.svgCssAttributes, ...node.svgStyleAttributes }
}

/** The element an href ("#id") or url(#id) refers to. */
function referenced(reference: unknown, context: DrawingContext): SvgNode | undefined {
  const id = String(reference ?? '').match(/#([^)\s]+)/)?.[1]

  return id === undefined ? undefined : context.nodesById.get(id)
}

function elementsOf(node: SvgNode, context: DrawingContext): DrawingElement[] {
  const tag = node.type
  if (!PART_TAG_SET.has(tag) || UNDRAWN_TAGS.has(tag)) return []
  if (tag === 'use') return useElements(node, context)

  const attributes = resolvedPercentages(tag, attributesOf(node), context.viewport, emSizeOf(node))
  if (attributes.display === 'none') return []

  const visibility = attributes.visibility ?? context.visibility
  const isHidden = visibility === 'hidden' || visibility === 'collapse'
  if (isHidden && VISIBLE_TAGS.has(tag)) return []

  const nested = { ...context, visibility }
  let children = node.children.flatMap((child) => elementsOf(child, nested))

  if (context.isPressable(node)) attributes.nodeId = node.id
  applyFilter(attributes, context)
  // A gradient's or pattern's href lends it the attributes it doesn't set, and its content when it has none.
  if (tag in UNITS_ATTRIBUTE_BY_TAG) {
    const inherited = referenced(attributes.href ?? attributes['xlink:href'], context)

    if (inherited) {
      const inheritedAttributes = resolvedPercentages(
        tag,
        attributesOf(inherited),
        context.viewport,
      )

      Object.assign(attributes, { ...inheritedAttributes, ...attributes })
      if (children.length === 0) {
        children = inherited.children.flatMap((child) => elementsOf(child, context))
      }
    }
  }
  if (tag === 'text') return [[tag, attributes, textRuns(node, context)]]
  if (MARKED_TAGS.has(tag)) return withMarkers([tag, attributes, children], node, context)

  // A link groups what it holds: there's nothing to follow in an app.
  return [[tag === 'a' ? 'g' : tag, attributes, children]]
}

/** What em is: the font size the element inherits, 16 without one. */
function emSizeOf(node: SvgNode): number {
  const fontSize = inheritedAttribute(node, 'font-size')

  return typeof fontSize === 'number' ? fontSize : 16
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

/** A <symbol>'s viewBox fitted into the <use>'s width and height. */
function symbolFit(symbol: SvgNode, useAttributes: Record<string, unknown>): number[] {
  const viewBox = symbol.svgAttributes?.viewBox as number[] | undefined
  if (viewBox?.length !== 4) return IDENTITY

  const width = Number(useAttributes.width ?? symbol.svgAttributes?.width) || viewBox[2]
  const height = Number(useAttributes.height ?? symbol.svgAttributes?.height) || viewBox[3]

  return viewBoxFit(viewBox, width, height, symbol.svgAttributes?.preserveAspectRatio)
}

/**
 * A viewBox fitted into a width and height as preserveAspectRatio says: "xMidYMid meet" (the default) scales
 * it to fit and centers it, "slice" to cover, "none" stretches it; xMin, YMax... align it.
 */
export function viewBoxFit(
  [minX, minY, boxWidth, boxHeight]: number[],
  width: number,
  height: number,
  preserveAspectRatio: unknown = '',
): number[] {
  if (!boxWidth || !boxHeight) return IDENTITY

  const [align = 'xMidYMid', meetOrSlice] = String(preserveAspectRatio).trim().split(/\s+/)
  let scaleX = width / boxWidth
  let scaleY = height / boxHeight

  if (align !== 'none') {
    scaleX = scaleY = meetOrSlice === 'slice' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY)
  }

  const translateX = alignment(align.slice(1, 4)) * (width - boxWidth * scaleX)
  const translateY = alignment(align.slice(5, 8)) * (height - boxHeight * scaleY)

  return [scaleX, 0, 0, scaleY, translateX - minX * scaleX, translateY - minY * scaleY]
}

function alignment(position: string): number {
  if (position === 'Min') return 0

  return position === 'Max' ? 1 : 0.5
}

/**
 * filter="url(#id)" in place: what native draws, `shadows` ([dx, dy, blur, color, inner], under the
 * element or, inner, inside it), a `blur` and a `colorMatrix` of the element itself.
 */
function applyFilter(attributes: Record<string, unknown>, context: DrawingContext) {
  if (!attributes.filter) return

  Object.assign(attributes, filterEffects(referenced(attributes.filter, context)))
  delete attributes.filter
}

type Shadow = { dx: number; dy: number; blur: number; color: number; isInner: boolean }

// A shadow without a color of its own, as in a hand-written <feOffset> and <feMerge>.
const DEFAULT_SHADOW_COLOR = 0x00000080

/**
 * The effects native draws, read in order: an <feDropShadow>; each <feOffset> starts a shadow (design
 * tools export one per effect), blurred by the <feGaussianBlur> around it, colored by an
 * <feColorMatrix> or <feFlood>, and inside the element when an <feComposite operator="arithmetic">
 * cuts it to the element (an inner shadow); with no <feOffset>, <feGaussianBlur> and <feColorMatrix>
 * apply to the element itself. Other primitives draw nothing.
 */
function filterEffects(filter: SvgNode | undefined): Record<string, unknown> {
  const shadows: Shadow[] = []
  let current: Shadow | undefined
  let pendingBlur = 0
  let blur = 0
  let colorMatrix: number[] | undefined

  for (const primitive of filter?.children ?? []) {
    const attributes = attributesOf(primitive)
    const readsSourceAlpha = attributes.in === 'SourceAlpha'

    switch (primitive.type) {
      case 'feDropShadow':
        shadows.push({
          dx: Number(attributes.dx ?? 2),
          dy: Number(attributes.dy ?? 2),
          blur: deviationOf(attributes.stdDeviation ?? 2),
          color: floodColor(attributes),
          isInner: false,
        })
        break
      case 'feOffset':
        current = {
          dx: Number(attributes.dx ?? 0),
          dy: Number(attributes.dy ?? 0),
          blur: pendingBlur,
          color: DEFAULT_SHADOW_COLOR,
          isInner: false,
        }
        shadows.push(current)
        pendingBlur = 0
        break
      case 'feGaussianBlur':
        if (current) current.blur = deviationOf(attributes.stdDeviation)
        else if (readsSourceAlpha) pendingBlur = deviationOf(attributes.stdDeviation)
        else blur = deviationOf(attributes.stdDeviation)
        break
      case 'feComposite':
        if (current && attributes.operator === 'arithmetic') current.isInner = true
        break
      case 'feFlood':
        // Design tools add a transparent one for the background.
        if (current && Number(attributes['flood-opacity'] ?? 1) > 0)
          current.color = floodColor(attributes)
        break
      case 'feColorMatrix': {
        if (readsSourceAlpha) break

        const matrix = colorMatrixOf(attributes)

        if (current && matrix) current.color = matrixColor(matrix)
        else if (matrix) colorMatrix = matrix
        break
      }
    }
  }

  return {
    ...(shadows.length > 0 && {
      shadows: shadows.map(({ dx, dy, blur, color, isInner }) => [
        dx,
        dy,
        blur,
        color,
        isInner ? 1 : 0,
      ]),
    }),
    ...(blur > 0 && { blur }),
    ...(colorMatrix && { colorMatrix }),
  }
}

/** stdDeviation="4" or "4 4": one deviation, both ways. */
function deviationOf(value: unknown): number {
  return Number.parseFloat(String(value ?? 0)) || 0
}

function floodColor(attributes: Record<string, unknown>): number {
  const color =
    typeof attributes['flood-color'] === 'number' ? attributes['flood-color'] : 0x000000ff
  const alpha = Math.round((color & 0xff) * Number(attributes['flood-opacity'] ?? 1))

  return ((color & 0xffffff00) | alpha) >>> 0
}

// The weights SVG's saturate and hueRotate give red, green and blue (Filter Effects, feColorMatrix).
const LUMINANCE = [0.213, 0.715, 0.072]
const IDENTITY_ALPHA_ROW = [0, 0, 0, 1, 0]

/** An <feColorMatrix>'s 4×5 matrix, row by row: type="matrix", "saturate", "hueRotate" or "luminanceToAlpha". */
function colorMatrixOf(attributes: Record<string, unknown>): number[] | undefined {
  const values = String(attributes.values ?? '')
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)

  switch (attributes.type ?? 'matrix') {
    case 'matrix':
      return values.length === 20 ? values : undefined
    case 'saturate':
      return rgbMatrix(saturation(values[0] ?? 1))
    case 'hueRotate':
      return rgbMatrix(hueRotation(((values[0] ?? 0) * Math.PI) / 180))
    case 'luminanceToAlpha':
      return [...Array(15).fill(0), 0.2125, 0.7154, 0.0721, 0, 0]
    default:
      return undefined
  }
}

function saturation(amount: number): number[][] {
  return [0, 1, 2].map((row) =>
    LUMINANCE.map((weight, column) => weight * (1 - amount) + (column === row ? amount : 0)),
  )
}

function hueRotation(radians: number): number[][] {
  const [cos, sin] = [Math.cos(radians), Math.sin(radians)]
  const byCos = [
    [0.787, -0.715, -0.072],
    [-0.213, 0.285, -0.072],
    [-0.213, -0.715, 0.928],
  ]
  const bySin = [
    [-0.213, -0.715, 0.928],
    [0.143, 0.14, -0.283],
    [-0.787, 0.715, 0.072],
  ]

  return [0, 1, 2].map((row) =>
    LUMINANCE.map((weight, column) => weight + cos * byCos[row][column] + sin * bySin[row][column]),
  )
}

/** A 3×3 matrix on red, green and blue, alpha kept, as a 4×5 color matrix. */
function rgbMatrix(rows: number[][]): number[] {
  return [...rows.flatMap((row) => [...row, 0, 0]), ...IDENTITY_ALPHA_ROW]
}

/**
 * The color a matrix paints a shadow with: design tools write "0 0 0 0 red 0 0 0 0 green 0 0 0 0 blue 0
 * 0 0 opacity 0".
 */
function matrixColor(matrix: number[]): number {
  const channel = (value: number) => Math.round(Math.min(Math.max(value, 0), 1) * 255)

  return (
    ((channel(matrix[4]) << 24) |
      (channel(matrix[9]) << 16) |
      (channel(matrix[14]) << 8) |
      channel(matrix[18])) >>>
    0
  )
}

/**
 * <text>'s runs: its text and its <tspan>s, each with its own position (x, y, dx, dy) and style, whitespace
 * collapsed as in SVG.
 */
function textRuns(node: SvgNode, context: DrawingContext): DrawingElement[] {
  const runs: DrawingElement[] = node.children.flatMap((child): DrawingElement[] => {
    if (child.type === '#text') return [['tspan', {}, child.text]]
    if (child.type === 'textPath') return textPathRun(child, context)
    if (child.type !== 'tspan') return []

    const attributes = resolvedPercentages(
      'tspan',
      attributesOf(child),
      context.viewport,
      emSizeOf(child),
    )

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

/**
 * <textPath href="#id">: its text along the path, which native lays out. The path goes with it, its d and
 * transform.
 */
function textPathRun(node: SvgNode, context: DrawingContext): DrawingElement[] {
  const attributes = resolvedPercentages('textPath', attributesOf(node), context.viewport)
  const path = referenced(attributes.href ?? attributes['xlink:href'], context)
  if (path?.type !== 'path') return []

  const { d, transform } = attributesOf(path)

  delete attributes.href
  delete attributes['xlink:href']

  return [['textPath', { ...attributes, d, pathTransform: transform }, textOf(node)]]
}

function resolvedPercentages(
  tag: string,
  attributes: Record<string, unknown>,
  viewport: Viewport,
  emSize = 16,
) {
  const diagonal = Math.hypot(viewport.width, viewport.height) / Math.SQRT2
  const unitsAttribute = UNITS_ATTRIBUTE_BY_TAG[tag]

  for (const [name, value] of Object.entries(attributes)) {
    if (typeof value === 'string' && /\d(em|ex)$/i.test(value)) {
      const ems = Number.parseFloat(value) * (value.toLowerCase().endsWith('ex') ? 0.5 : 1)

      attributes[name] = ems * emSize
      continue
    }
    if (typeof value !== 'string' || !value.endsWith('%')) continue
    if (NATIVE_PERCENTAGE_ATTRIBUTES.has(name)) continue

    const fraction = Number.parseFloat(value) / 100
    // A gradient or pattern in the drawing's units (userSpaceOnUse) takes percentages of the viewport, as
    // shapes do.
    const isFraction =
      OPACITY_ATTRIBUTES.has(name) ||
      tag === 'stop' ||
      (unitsAttribute !== undefined && attributes[unitsAttribute] !== 'userSpaceOnUse')

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

// Markers: marker-start, marker-mid and marker-end draw a <marker>'s content at a shape's vertices, turned
// with it (orient="auto"). They become plain groups in the drawing.
const MARKED_TAGS = new Set(['path', 'line', 'polyline', 'polygon'])
const MARKER_POSITIONS = ['marker-start', 'marker-mid', 'marker-end'] as const
// What applies to a marked shape as a whole, markers included.
const GROUP_ATTRIBUTES = [
  'transform',
  'opacity',
  'clip-path',
  'mask',
  'shadows',
  'blur',
  'colorMatrix',
  'nodeId',
]

type Vertex = { x: number; y: number; directionIn?: number[]; directionOut?: number[] }

/** The shape, and its markers when it has any, grouped so its transform and opacity apply to them too. */
function withMarkers(
  shape: DrawingElement,
  node: SvgNode,
  context: DrawingContext,
): DrawingElement[] {
  const markers = MARKER_POSITIONS.map((position) =>
    referenced(inheritedAttribute(node, position) ?? inheritedAttribute(node, 'marker'), context),
  )
  if (!markers.some(Boolean)) return [shape]

  const [tag, attributes] = shape
  const vertices = verticesOf(tag, attributes)
  const strokeWidth = Number(inheritedAttribute(node, 'stroke-width') ?? 1)
  const groupAttributes: Record<string, unknown> = {}
  const nested = { ...context, isPressable: () => false }

  for (const name of GROUP_ATTRIBUTES) {
    if (name in attributes) groupAttributes[name] = attributes[name]
    delete attributes[name]
  }

  const placed = vertices.flatMap((vertex, index) => {
    const position = index === 0 ? 0 : index === vertices.length - 1 ? 2 : 1
    const marker = markers[position]

    return marker ? [markerAt(marker, vertex, index === 0, strokeWidth, nested)] : []
  })

  return [['g', groupAttributes, [shape, ...placed]]]
}

/** Marker properties are inherited: one on a <g> marks every shape inside it. */
function inheritedAttribute(node: SvgNode, name: string): unknown {
  for (let current: SvgNode | null = node; current; current = current.parent) {
    const value = current.svgStyleAttributes?.[name] ?? current.svgAttributes?.[name]

    if (value !== undefined) return value
  }

  return undefined
}

/** A <marker>'s content placed at a vertex: refX and refY on it, turned and scaled as the marker says. */
function markerAt(
  marker: SvgNode,
  vertex: Vertex,
  isStart: boolean,
  strokeWidth: number,
  context: DrawingContext,
): DrawingElement {
  const attributes = attributesOf(marker)
  const width = Number(attributes.markerWidth ?? 3)
  const height = Number(attributes.markerHeight ?? 3)
  const viewBox = attributes.viewBox as number[] | undefined
  const fit =
    viewBox?.length === 4
      ? viewBoxFit(viewBox, width, height, attributes.preserveAspectRatio)
      : IDENTITY
  const [referenceX, referenceY] = applied(
    fit,
    Number(attributes.refX ?? 0),
    Number(attributes.refY ?? 0),
  )
  const scale = attributes.markerUnits === 'userSpaceOnUse' ? 1 : strokeWidth
  const angle = markerAngle(String(attributes.orient ?? '0'), vertex, isStart)
  const transform = [
    [1, 0, 0, 1, vertex.x, vertex.y],
    rotation(angle),
    [scale, 0, 0, scale, 0, 0],
    [1, 0, 0, 1, -referenceX, -referenceY],
    fit,
  ].reduce(multiply)

  return [
    'g',
    { ...markerStyle(marker), transform },
    marker.children.flatMap((child) => elementsOf(child, context)),
  ]
}

// What a marker's content would otherwise inherit from the marked shape: SVG's defaults.
const MARKER_STYLE_DEFAULTS: Record<string, unknown> = {
  fill: 0x000000ff,
  stroke: 'none',
  'stroke-width': 1,
  'fill-opacity': 1,
  'stroke-opacity': 1,
  'stroke-linecap': 'butt',
  'stroke-linejoin': 'miter',
  'stroke-dasharray': [],
  'stroke-dashoffset': 0,
  'fill-rule': 'nonzero',
}

/** A marker's content inherits from where the <marker> is, not from the shape it marks. */
function markerStyle(marker: SvgNode): Record<string, unknown> {
  const ancestors: SvgNode[] = []

  for (let current: SvgNode | null = marker; current; current = current.parent)
    ancestors.unshift(current)

  const style = { ...MARKER_STYLE_DEFAULTS }

  for (const ancestor of ancestors) {
    const attributes = attributesOf(ancestor)

    for (const name in MARKER_STYLE_DEFAULTS) if (name in attributes) style[name] = attributes[name]
  }

  return style
}

function applied([a, b, c, d, e, f]: number[], x: number, y: number): number[] {
  return [a * x + c * y + e, b * x + d * y + f]
}

function rotation(radians: number): number[] {
  return [Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), 0, 0]
}

/** orient="auto": along the path, halfway between the ways in and out at a vertex. An angle: fixed. */
function markerAngle(orient: string, vertex: Vertex, isStart: boolean): number {
  if (orient !== 'auto' && orient !== 'auto-start-reverse') {
    return (Number.parseFloat(orient) || 0) * (Math.PI / 180)
  }

  const [inX, inY] = unit(vertex.directionIn ?? vertex.directionOut)
  const [outX, outY] = unit(vertex.directionOut ?? vertex.directionIn)
  const angle = Math.atan2(inY + outY, inX + outX)

  return orient === 'auto-start-reverse' && isStart ? angle + Math.PI : angle
}

function unit(vector = [1, 0]): number[] {
  const length = Math.hypot(vector[0], vector[1])

  return length === 0 ? [0, 0] : [vector[0] / length, vector[1] / length]
}

function verticesOf(tag: string, attributes: Record<string, unknown>): Vertex[] {
  if (tag === 'path') return pathVertices(String(attributes.d ?? ''))

  const points =
    tag === 'line'
      ? [
          Number(attributes.x1) || 0,
          Number(attributes.y1) || 0,
          Number(attributes.x2) || 0,
          Number(attributes.y2) || 0,
        ]
      : (String(attributes.points ?? '').match(NUMBER) ?? []).map(Number)
  const builder = new VertexBuilder()

  for (let index = 0; index + 1 < points.length; index += 2) {
    if (index === 0) builder.moveTo(points[0], points[1])
    else builder.lineTo(points[index], points[index + 1])
  }
  if (tag === 'polygon') builder.close()

  return builder.vertices
}

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g

/** Vertices as a path is drawn: each segment ends at one, with the direction it arrives and leaves in. */
class VertexBuilder {
  vertices: Vertex[] = []
  current = [0, 0]
  private subpathStart = 0

  moveTo(x: number, y: number) {
    this.subpathStart = this.vertices.length
    this.vertices.push({ x, y })
    this.current = [x, y]
  }

  /** A segment to (x, y), leaving the current point towards `out` and arriving from `into`. */
  segmentTo(x: number, y: number, out: number[], into: number[]) {
    const last = this.vertices.at(-1)

    if (last) last.directionOut = out
    this.vertices.push({ x, y, directionIn: into })
    this.current = [x, y]
  }

  lineTo(x: number, y: number) {
    const direction = [x - this.current[0], y - this.current[1]]

    this.segmentTo(x, y, direction, direction)
  }

  close() {
    const start = this.vertices[this.subpathStart]
    if (!start) return

    if (start.x !== this.current[0] || start.y !== this.current[1]) this.lineTo(start.x, start.y)
    // A closed shape's first vertex is also where it arrives.
    start.directionIn = this.vertices.at(-1)?.directionIn
    this.current = [start.x, start.y]
  }
}

/** A path's vertices, for markers: every command, absolute and relative. */
function pathVertices(d: string): Vertex[] {
  const builder = new VertexBuilder()
  const reader = new PathReader(d)
  let command = 'M'
  let subpathStart = [0, 0]
  let lastControl: number[] | undefined

  for (;;) {
    const next = reader.command()
    if (next) command = next
    else if (reader.isAtEnd() || /z/i.test(command)) break

    const isRelative = command === command.toLowerCase()
    const [currentX, currentY] = builder.current
    const point = () => {
      const x = reader.number()
      const y = reader.number()

      return x === undefined || y === undefined
        ? undefined
        : isRelative
          ? [x + currentX, y + currentY]
          : [x, y]
    }
    const toward = (to: number[], from: number[]) => [to[0] - from[0], to[1] - from[1]]
    let control: number[] | undefined

    switch (command.toUpperCase()) {
      case 'M': {
        const end = point()
        if (!end) return builder.vertices

        builder.moveTo(end[0], end[1])
        subpathStart = end
        command = isRelative ? 'l' : 'L'
        break
      }
      case 'L': {
        const end = point()
        if (!end) return builder.vertices

        builder.lineTo(end[0], end[1])
        break
      }
      case 'H':
      case 'V': {
        const value = reader.number()
        if (value === undefined) return builder.vertices

        const isHorizontal = command.toUpperCase() === 'H'
        const offset = isRelative ? (isHorizontal ? currentX : currentY) : 0

        builder.lineTo(
          isHorizontal ? value + offset : currentX,
          isHorizontal ? currentY : value + offset,
        )
        break
      }
      case 'C':
      case 'S':
      case 'Q':
      case 'T': {
        const upper = command.toUpperCase()
        const current = builder.current
        const reflected = lastControl
          ? [2 * current[0] - lastControl[0], 2 * current[1] - lastControl[1]]
          : current
        const first = upper === 'C' || upper === 'Q' ? point() : reflected
        const second = upper === 'C' || upper === 'S' ? point() : first
        const end = point()
        if (!first || !second || !end) return builder.vertices

        const out = toward(first, current)
        const into = toward(end, second)

        builder.segmentTo(
          end[0],
          end[1],
          out[0] || out[1] ? out : toward(second, current),
          into[0] || into[1] ? into : toward(end, first),
        )
        control = second
        break
      }
      case 'A': {
        const values = [
          reader.number(),
          reader.number(),
          reader.number(),
          reader.flag(),
          reader.flag(),
        ]
        const end = point()
        if (!end || values.includes(undefined)) return builder.vertices

        // ponytail: an arc's ends turn along its chord, not its tangent; exact for markers on lines and
        // polylines, close enough on shallow arcs.
        builder.lineTo(end[0], end[1])
        break
      }
      case 'Z':
        builder.close()
        builder.current = subpathStart
        break
      default:
        return builder.vertices
    }

    lastControl = control
  }

  return builder.vertices
}

/** Path data read a token at a time, in the compact forms optimizers emit ("l.5.9", arc flags "01"). */
class PathReader {
  private index = 0

  constructor(private readonly text: string) {}

  isAtEnd(): boolean {
    this.skipSeparators()

    return this.index >= this.text.length
  }

  command(): string | undefined {
    this.skipSeparators()

    const character = this.text[this.index]
    if (!character || !/[a-df-z]/i.test(character)) return undefined

    this.index++

    return character
  }

  number(): number | undefined {
    this.skipSeparators()

    const match = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(this.text.slice(this.index))
    if (!match) return undefined

    this.index += match[0].length

    return Number(match[0])
  }

  flag(): number | undefined {
    this.skipSeparators()

    const character = this.text[this.index]
    if (character !== '0' && character !== '1') return undefined

    this.index++

    return Number(character)
  }

  private skipSeparators() {
    while (/[\s,]/.test(this.text[this.index] ?? '')) this.index++
  }
}
