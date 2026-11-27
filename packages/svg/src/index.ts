// <svg> drawn natively: its plugin registers it before the app starts (runtime.ts). These are the
// components' types, and svgIcon for tab bar and header icons.
import type { AccessibilityProps, DefineComponent, LayoutEvent, Style } from '@nativue/core'
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

declare module '@vue/runtime-core' {
  export interface GlobalComponents {
    Svg: DefineComponent<
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
    G: SvgComponent
    Path: SvgComponent<{ d?: string }>
    Circle: SvgComponent<{ cx?: SvgLength; cy?: SvgLength; r?: SvgLength }>
    Ellipse: SvgComponent<{ cx?: SvgLength; cy?: SvgLength; rx?: SvgLength; ry?: SvgLength }>
    Rect: SvgComponent<Box & { rx?: SvgLength; ry?: SvgLength }>
    Line: SvgComponent<{ x1?: SvgLength; y1?: SvgLength; x2?: SvgLength; y2?: SvgLength }>
    Polyline: SvgComponent<{ points?: string }>
    Polygon: SvgComponent<{ points?: string }>
    SvgText: SvgComponent<TextAttributes>
    Tspan: SvgComponent<TextAttributes>
    TextPath: SvgComponent<TextAttributes & { href?: string; startOffset?: SvgLength }>
    SvgImage: SvgComponent<Box & { href?: string | { uri: string }; preserveAspectRatio?: string }>
    Defs: SvgComponent
    Use: SvgComponent<Box & { href?: string }>
    Symbol: SvgComponent<{ viewBox?: string; preserveAspectRatio?: string }>
    LinearGradient: SvgComponent<
      GradientAttributes & { x1?: SvgLength; y1?: SvgLength; x2?: SvgLength; y2?: SvgLength }
    >
    RadialGradient: SvgComponent<
      GradientAttributes & {
        cx?: SvgLength
        cy?: SvgLength
        r?: SvgLength
        fx?: SvgLength
        fy?: SvgLength
      }
    >
    Stop: SvgComponent<{ offset?: SvgLength; stopColor?: string; stopOpacity?: number | string }>
    Pattern: SvgComponent<
      Box & {
        patternUnits?: 'objectBoundingBox' | 'userSpaceOnUse'
        patternContentUnits?: 'objectBoundingBox' | 'userSpaceOnUse'
        patternTransform?: string
        viewBox?: string
        preserveAspectRatio?: string
        href?: string
      }
    >
    Marker: SvgComponent<{
      markerWidth?: SvgLength
      markerHeight?: SvgLength
      markerUnits?: 'strokeWidth' | 'userSpaceOnUse'
      refX?: SvgLength
      refY?: SvgLength
      orient?: 'auto' | 'auto-start-reverse' | number | string
      viewBox?: string
      preserveAspectRatio?: string
    }>
    ClipPath: SvgComponent<{ clipPathUnits?: 'objectBoundingBox' | 'userSpaceOnUse' }>
    Mask: SvgComponent
    Filter: SvgComponent
    FeDropShadow: SvgComponent<{
      dx?: number | string
      dy?: number | string
      stdDeviation?: number | string
      floodColor?: string
      floodOpacity?: number | string
    }>
    FeGaussianBlur: SvgComponent<{ stdDeviation?: number | string; in?: string }>
    FeOffset: SvgComponent<{ dx?: number | string; dy?: number | string; in?: string }>
    FeFlood: SvgComponent<{ floodColor?: string; floodOpacity?: number | string }>
    FeColorMatrix: SvgComponent<{ type?: string; values?: string; in?: string }>
    FeComposite: SvgComponent
    FeBlend: SvgComponent
    FeMerge: SvgComponent
    FeMergeNode: SvgComponent<{ in?: string }>
    Title: SvgComponent
    Desc: SvgComponent
    Metadata: SvgComponent
  }
}
