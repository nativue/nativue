// Registers <svg> with nativue's renderer before the app starts: what's inside it stays in JS, and
// svg.ts makes the drawing.
import { camelize, registerDrawnView, type DrawnElement, type Style } from '@nativue/core'
import { attributeName, drawingAttribute, drawingOf, PART_TAGS, styleAttributes } from './svg'
import type { SvgNode } from './svg'

type SvgView = SvgNode & {
  /** Its width and height attributes: they size it under its class and style, as on the web. */
  svgSize?: Style
  /** An icon (@nativue/icons): the native view draws `elements`, not a drawing. */
  drawsElements?: boolean
}

// An icon's props, which its native view reads as they are; viewBox and stroke-width also draw.
const ICON_PROPS = new Set(['elements', 'color'])
const SHARED_PROPS = new Set(['viewBox', 'strokeWidth'])

function setAttribute(node: SvgNode, key: string, value: unknown) {
  const attribute = drawingAttribute(key, value)

  node.svgAttributes ??= {}
  if (attribute) node.svgAttributes[attribute[0]] = attribute[1]
  else delete node.svgAttributes[attributeName(key)]
}

function sizeValue(value: unknown): number | string | undefined {
  if (value == null) return undefined

  return /^\s*[\d.]+(px)?\s*$/.test(String(value))
    ? Number.parseFloat(String(value))
    : String(value)
}

registerDrawnView({
  type: 'Svg',
  tags: ['svg'],
  partTags: PART_TAGS,

  setPartProp(element, key, value) {
    const node = element as SvgNode

    if (key === 'style') node.svgStyleAttributes = styleAttributes(value)
    else if (key !== 'class') setAttribute(node, key, value)
  },

  setViewProp(element, key, value, setBaseStyle) {
    const view = element as SvgView
    const name = camelize(key)

    if (key === 'width' || key === 'height') {
      view.svgSize = { ...view.svgSize, [key]: sizeValue(value) }
      setBaseStyle(view.svgSize)
      setAttribute(view, key, value)

      return true
    }
    if (name === 'elements') view.drawsElements = value != null
    if (ICON_PROPS.has(name)) return false

    setAttribute(view, key, value)

    return !SHARED_PROPS.has(name)
  },

  drawing(element: DrawnElement, isPressable) {
    const view = element as SvgView

    return view.drawsElements ? undefined : drawingOf(view, isPressable)
  },
})
