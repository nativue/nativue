// <svg> drawn natively: its plugin registers the tags before the app starts (runtime.ts). Here are the
// elements as components, <Path> for <path>, and svgIcon for tab bar and header icons.
import {
  h,
  type AccessibilityProps,
  type DefineComponent,
  type FunctionalComponent,
  type LayoutEvent,
  type Style,
} from '@nativue/core'
import type { DrawnIcon } from '@nativue/core/router'

type SvgLength = number | string
type ViewBox = [minX: number, minY: number, width: number, height: number]

/** Inherited by what's inside, as in SVG: fill, stroke... A color, 'none', 'currentColor' or 'url(#id)'. */
export interface SvgPresentationAttributes {
  id?: string
  fill?: string
  stroke?: string
  strokeWidth?: SvgLength
  strokeLinecap?: 'butt' | 'round' | 'square'
  strokeLinejoin?: 'miter' | 'round' | 'bevel'
  strokeMiterlimit?: number | string
  strokeDasharray?: string
  strokeDashoffset?: SvgLength
  opacity?: number | string
  fillOpacity?: number | string
  strokeOpacity?: number | string
  fillRule?: 'nonzero' | 'evenodd'
  clipRule?: 'nonzero' | 'evenodd'
  transform?: string
  clipPath?: string
  mask?: string
  filter?: string
  markerStart?: string
  markerMid?: string
  markerEnd?: string
  display?: 'none' | 'inline'
  style?: string | Record<string, string | number>
  /** A press on the element (or on a group's), where it's drawn. */
  onPress?: (location: { x: number; y: number }) => void
}

type TextAttributes = {
  x?: SvgLength
  y?: SvgLength
  dx?: SvgLength
  dy?: SvgLength
  fontSize?: SvgLength
  fontWeight?: string | number
  fontFamily?: string
  letterSpacing?: SvgLength
  textAnchor?: 'start' | 'middle' | 'end'
  dominantBaseline?: 'auto' | 'middle' | 'central' | 'hanging' | 'text-top' | 'text-bottom'
}
type GradientAttributes = {
  gradientUnits?: 'objectBoundingBox' | 'userSpaceOnUse'
  gradientTransform?: string
  spreadMethod?: 'pad' | 'reflect' | 'repeat'
  href?: string
}
type Box = { x?: SvgLength; y?: SvgLength; width?: SvgLength; height?: SvgLength }
type SvgComponent<Props = {}> = DefineComponent<SvgPresentationAttributes & Props>

/** [tag, attributes], e.g. ['circle', { cx: 12, cy: 12, r: 10 }]: an icon's shapes. */
export type SvgElement = [tag: string, attributes: Record<string, string | number>]

/**
 * A tab bar or header icon drawn from shapes, stroked like an icon set's (round caps and joins); a shape
 * whose fill isn't 'none' is filled too:
 * `tabBarIcon: svgIcon([0, 0, 24, 24], [['path', { d: 'M3 12h18' }]])`.
 */
export function svgIcon(viewBox: ViewBox, elements: SvgElement[]): DrawnIcon {
  return { drawnIcon: { drawer: 'svg', viewBox, elements } }
}

/** Renders the element with what it's given: <Path d="..."> is <path d="...">. */
function component<Component>(tag: string): Component {
  const render: FunctionalComponent = (_props, { attrs, slots }) => h(tag, attrs, slots.default?.())

  return render as Component
}

export const Svg = component<
  DefineComponent<
    SvgPresentationAttributes &
      AccessibilityProps & {
        viewBox?: string | ViewBox
        width?: number | string
        height?: number | string
        preserveAspectRatio?: string
        /** An icon's shapes (@nativue/icons): drawn instead of what's inside, stroked with `color`. */
        elements?: SvgElement[]
        color?: string
        style?: Style
        onLayout?: (event: LayoutEvent) => void
      }
  >
>('svg')
export const G = component<SvgComponent>('g')
export const Path = component<SvgComponent<{ d?: string }>>('path')
export const Circle =
  component<SvgComponent<{ cx?: SvgLength; cy?: SvgLength; r?: SvgLength }>>('circle')
export const Ellipse =
  component<SvgComponent<{ cx?: SvgLength; cy?: SvgLength; rx?: SvgLength; ry?: SvgLength }>>(
    'ellipse',
  )
export const Rect = component<SvgComponent<Box & { rx?: SvgLength; ry?: SvgLength }>>('rect')
export const Line =
  component<SvgComponent<{ x1?: SvgLength; y1?: SvgLength; x2?: SvgLength; y2?: SvgLength }>>(
    'line',
  )
export const Polyline = component<SvgComponent<{ points?: string }>>('polyline')
export const Polygon = component<SvgComponent<{ points?: string }>>('polygon')
export const Text = component<SvgComponent<TextAttributes>>('text')
export const Tspan = component<SvgComponent<TextAttributes>>('tspan')
export const TextPath =
  component<SvgComponent<TextAttributes & { href?: string; startOffset?: SvgLength }>>('textPath')
export const Image =
  component<SvgComponent<Box & { href?: string | { uri: string }; preserveAspectRatio?: string }>>(
    'image',
  )
export const Defs = component<SvgComponent>('defs')
export const Use = component<SvgComponent<Box & { href?: string }>>('use')
export const Symbol =
  component<SvgComponent<{ viewBox?: string; preserveAspectRatio?: string }>>('symbol')
export const LinearGradient =
  component<
    SvgComponent<
      GradientAttributes & { x1?: SvgLength; y1?: SvgLength; x2?: SvgLength; y2?: SvgLength }
    >
  >('linearGradient')
export const RadialGradient = component<
  SvgComponent<
    GradientAttributes & {
      cx?: SvgLength
      cy?: SvgLength
      r?: SvgLength
      fx?: SvgLength
      fy?: SvgLength
    }
  >
>('radialGradient')
export const Stop =
  component<
    SvgComponent<{ offset?: SvgLength; stopColor?: string; stopOpacity?: number | string }>
  >('stop')
export const Pattern = component<
  SvgComponent<
    Box & {
      patternUnits?: 'objectBoundingBox' | 'userSpaceOnUse'
      patternContentUnits?: 'objectBoundingBox' | 'userSpaceOnUse'
      patternTransform?: string
      viewBox?: string
      preserveAspectRatio?: string
      href?: string
    }
  >
>('pattern')
export const Marker = component<
  SvgComponent<{
    markerWidth?: SvgLength
    markerHeight?: SvgLength
    markerUnits?: 'strokeWidth' | 'userSpaceOnUse'
    refX?: SvgLength
    refY?: SvgLength
    orient?: 'auto' | 'auto-start-reverse' | number | string
    viewBox?: string
    preserveAspectRatio?: string
  }>
>('marker')
export const ClipPath =
  component<SvgComponent<{ clipPathUnits?: 'objectBoundingBox' | 'userSpaceOnUse' }>>('clipPath')
export const Mask = component<SvgComponent>('mask')
export const Filter = component<SvgComponent>('filter')
export const FeDropShadow = component<
  SvgComponent<{
    dx?: number | string
    dy?: number | string
    stdDeviation?: number | string
    floodColor?: string
    floodOpacity?: number | string
  }>
>('feDropShadow')
export const FeGaussianBlur =
  component<SvgComponent<{ stdDeviation?: number | string; in?: string }>>('feGaussianBlur')
export const FeOffset =
  component<SvgComponent<{ dx?: number | string; dy?: number | string; in?: string }>>('feOffset')
export const FeFlood =
  component<SvgComponent<{ floodColor?: string; floodOpacity?: number | string }>>('feFlood')
export const FeColorMatrix =
  component<SvgComponent<{ type?: string; values?: string; in?: string }>>('feColorMatrix')
export const FeComposite = component<SvgComponent>('feComposite')
export const FeBlend = component<SvgComponent>('feBlend')
export const FeMerge = component<SvgComponent>('feMerge')
export const FeMergeNode = component<SvgComponent<{ in?: string }>>('feMergeNode')
export const Title = component<SvgComponent>('title')
export const Desc = component<SvgComponent>('desc')
export const Metadata = component<SvgComponent>('metadata')
