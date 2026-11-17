// Custom renderer: instead of the DOM, operations are sent to the native side (globalThis.__native).
import './globals'
import './fetch'
import './native-components'
import {
  callWithAsyncErrorHandling,
  camelize,
  createRenderer,
  ErrorCodes,
  type Component,
  type ComponentInternalInstance,
  type ComponentPublicInstance,
  type Directive,
} from '@vue/runtime-core'
import { animatedEventMapping, animatedStyleBinding, isAnimatedEvent } from './animated'
import { COLOR_PROPERTIES, processColor } from './colors'
import { FlatList, Pressable, Swipeable } from './components'
import type { LayoutAnimationConfig, Style } from './types'
export * from '@vue/runtime-core'
export { Animated } from './animated'
export { AsyncStorage } from './storage'
export type * from './types'
export type { SvgElement, SvgIcon } from './native-components'

interface Node {
  id: number
  type: string
  parent: Node | null
  children: Node[]
  text: string
}

type EventHandler = (payload: unknown) => void

const native = globalThis.__native
let nextNodeId = 1
// ponytail: handlers of removed nodes are never cleaned up; clean them on remove when it matters.
const eventHandlersByNodeId: Record<number, Record<string, EventHandler | undefined>> = {}

function createNode(type: string): Node {
  return { id: nextNodeId++, type, parent: null, children: [], text: '' }
}

// '#text' and '#comment' nodes only exist in JS (Vue anchors / raw text); native never sees them.
function isNativeNode(node: Node): boolean {
  return !node.type.startsWith('#')
}

function isEventProp(key: string): boolean {
  return /^on[A-Z]/.test(key)
}

// Raw text inside <Text> becomes the text of the parent label.
// Text is trimmed like HTML does, so it can wrap onto its own lines in the template.
function syncTextContent(parent: Node | null) {
  if (parent?.type !== 'Text') return

  const text = parent.children
    .map((child) => child.text)
    .join('')
    .trim()
  native.setText(parent.id, text)
}

function detachFromParent(node: Node): Node | null {
  const parent = node.parent
  if (!parent) return null

  parent.children.splice(parent.children.indexOf(node), 1)
  node.parent = null

  return parent
}

function nativeIndexBefore(parent: Node, childIndex: number): number {
  return parent.children.slice(0, childIndex).filter(isNativeNode).length
}

function nativeStyleValue(property: string, value: unknown): unknown {
  return COLOR_PROPERTIES.has(property) ? processColor(value) : value
}

// Only changed properties cross the bridge; removed ones are sent as null.
function styleChanges(
  previousStyle: Record<string, unknown> = {},
  nextStyle: Record<string, unknown> = {},
): Record<string, unknown> {
  const changes: Record<string, unknown> = {}

  for (const property in nextStyle) {
    if (previousStyle[property] !== nextStyle[property]) {
      changes[property] = nativeStyleValue(property, nextStyle[property])
    }
  }

  for (const property in previousStyle) {
    if (!(property in nextStyle)) changes[property] = null
  }

  return changes
}

// The animated part of a style (opacity / transform holding Animated values) is bound natively
// instead of being sent as values.
function withoutAnimatedProperties(
  style: Style | null | undefined,
  binding: object | null,
): Record<string, unknown> {
  if (!style || !binding) return style ?? {}

  const staticStyle: Record<string, unknown> = { ...style }
  for (const property in binding) delete staticStyle[property]

  return staticStyle
}

function patchStyle(element: Node, previousStyle: Style | null, nextStyle: Style | null) {
  const previousBinding = animatedStyleBinding(previousStyle)
  const nextBinding = animatedStyleBinding(nextStyle)
  const changes = styleChanges(
    withoutAnimatedProperties(previousStyle, previousBinding),
    withoutAnimatedProperties(nextStyle, nextBinding),
  )

  if (Object.keys(changes).length > 0) native.setProp(element.id, 'style', changes)

  if (JSON.stringify(previousBinding) !== JSON.stringify(nextBinding)) {
    native.setAnimatedStyle(element.id, nextBinding)
  }
}

// <Image :source="logo" /> or :source="{ uri }". Color props (<ActivityIndicator
// color>) are converted like color styles.
function nativePropValue(key: string, value: unknown): unknown {
  if (value == null) return value
  if (key === 'source') return (value as { uri?: string }).uri ?? value
  if (COLOR_PROPERTIES.has(key)) return processColor(value)

  return value
}

// A gesture needs its recognizer even when only Animated.event uses it; a mapped scroll without a
// listener needs nothing from JS, so native doesn't report it every frame.
function reportsToJavaScript(eventName: string, handler: unknown): boolean {
  if (!isAnimatedEvent(handler)) return handler != null

  return eventName !== 'scroll' || handler.listener != null
}

// An Animated.event handler writes into values natively; JS keeps only its listener. Handlers run
// through Vue's error handling, like on the web, so an error names the component it came from.
function patchEventHandler(
  element: Node,
  key: string,
  previousHandler: unknown,
  handler: unknown,
  component: ComponentInternalInstance | null,
) {
  const eventName = key.slice(2).toLowerCase()
  const listener = isAnimatedEvent(handler) ? handler.listener : (handler as Function | undefined)
  eventHandlersByNodeId[element.id] ??= {}
  eventHandlersByNodeId[element.id][eventName] =
    listener &&
    ((payload) =>
      callWithAsyncErrorHandling(listener, component, ErrorCodes.NATIVE_EVENT_HANDLER, [payload]))

  native.setProp(element.id, key, reportsToJavaScript(eventName, handler))

  if (isAnimatedEvent(previousHandler) || isAnimatedEvent(handler)) {
    const mapping = isAnimatedEvent(handler) ? animatedEventMapping(handler) : null
    native.setAnimatedEvent(element.id, eventName, mapping)
  }
}

const { createApp: createBaseApp } = createRenderer<Node, Node>({
  createElement(type) {
    const element = createNode(type)
    native.create(element.id, type)

    return element
  },

  createText(text) {
    const textNode = createNode('#text')
    textNode.text = text

    return textNode
  },

  createComment() {
    return createNode('#comment')
  },

  setText(textNode, text) {
    textNode.text = text
    syncTextContent(textNode.parent)
  },

  setElementText(element, text) {
    element.children = []
    if (element.type === 'Text') native.setText(element.id, text.trim())
  },

  insert(child, parent, anchor) {
    detachFromParent(child) // moving: native repositions the view on insert

    const index = anchor ? parent.children.indexOf(anchor) : parent.children.length
    parent.children.splice(index, 0, child)
    child.parent = parent

    if (isNativeNode(child)) native.insert(parent.id, child.id, nativeIndexBefore(parent, index))
    else syncTextContent(parent)
  },

  remove(child) {
    const parent = detachFromParent(child)

    if (isNativeNode(child)) native.remove(child.id)
    else syncTextContent(parent)
  },

  parentNode(node) {
    return node.parent
  },

  nextSibling(node) {
    const siblings = node.parent?.children

    return siblings?.[siblings.indexOf(node) + 1] ?? null
  },

  patchProp(element, key, previousValue, nextValue, _namespace, component) {
    if (key === 'style') patchStyle(element, previousValue, nextValue)
    // :on-pan="..." (v-bind, used for Animated.event) arrives kebab-case.
    else if (isEventProp(camelize(key))) {
      patchEventHandler(element, camelize(key), previousValue, nextValue, component ?? null)
    } else native.setProp(element.id, camelize(key), nativePropValue(key, nextValue) ?? null) // keyboard-type -> keyboardType
  },
})

// v-model compiles to an "onUpdate:modelValue" handler; it listens to the same native event as
// @change-text (<TextInput>) or @value-change (<Switch>).
const MODEL_EVENT_BY_NATIVE_EVENT: Record<string, string> = {
  changetext: 'update:modelvalue',
  valuechange: 'update:modelvalue',
}

globalThis.__dispatch = (nodeId, eventName, payload) => {
  const handlers = eventHandlersByNodeId[nodeId]
  if (!handlers) return

  handlers[eventName]?.(payload)
  handlers[MODEL_EVENT_BY_NATIVE_EVENT[eventName]]?.(payload)
}

const LAYOUT_ANIMATION_PRESETS = {
  easeInEaseOut: { type: 'easeInEaseOut', duration: 300 },
  linear: { type: 'linear', duration: 500 },
  spring: { type: 'spring', duration: 700, springDamping: 0.4 },
} satisfies Record<string, LayoutAnimationConfig>

// Configure before changing state, and the native side animates every layout,
// opacity, color and transform change of that update.
//   LayoutAnimation.configureNext(LayoutAnimation.Presets.spring)
//   items.value.splice(index, 1)
export const LayoutAnimation = {
  Presets: LAYOUT_ANIMATION_PRESETS,

  configureNext(config: LayoutAnimationConfig = LAYOUT_ANIMATION_PRESETS.easeInEaseOut): void {
    native.configureNextLayoutAnimation(config)
  },
}

// Returns the styles as they are, only typing them (so flexDirection stays
// 'row' instead of widening to string).
export const StyleSheet = {
  create<Styles extends Record<string, Style>>(styles: Styles): Styles {
    return styles
  },
}

// Dimensions.get('window') -> { width, height } in points.
export const Dimensions = {
  get(_dimension: 'window'): { width: number; height: number } {
    return native.windowSize()
  },
}

export const Keyboard = {
  dismiss(): void {
    native.dismissKeyboard()
  },
}

// Replaces Vue's DOM-only vModelText, which the template compiler emits for v-model on
// <TextInput> and <Switch>.
// ponytail: v-model modifiers (.trim, .number, .lazy) are not supported yet.
export const vModelText: Directive<Node> = {
  created(element, { value }) {
    native.setProp(element.id, 'value', value ?? '')
  },

  beforeUpdate(element, { value, oldValue }) {
    if (value !== oldValue) native.setProp(element.id, 'value', value ?? '')
  },
}

const rootNode: Node = { id: 0, type: 'root', parent: null, children: [], text: '' }

// Errors in templates, setup, hooks and handlers: shown natively, with where they happened (in
// development, Vue's `info` reads like "native event handler").
function reportVueError(error: unknown, instance: ComponentPublicInstance | null, info: string) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  const stack = error instanceof Error ? (error.stack ?? '') : ''
  const trace = componentFiles(instance?.$ ?? null).map((file) => `  in ${file}`)

  native.reportError(message, [info, ...trace, '', stack].join('\n'))
}

// The app's components from `instance` up to the root (development builds only: they keep each
// component's file), e.g. a component, then the screen using it, then its layouts.
function componentFiles(instance: ComponentInternalInstance | null): string[] {
  const files: string[] = []

  for (let current = instance; current; current = current.parent) {
    const file = (current.type as { __file?: string }).__file
    if (file) files.push(file.slice(file.lastIndexOf('/src/') + 1))
  }

  return files
}

export function createApp(rootComponent: Component) {
  const app = createBaseApp(rootComponent)
  const mountOnContainer = app.mount

  app.config.errorHandler = reportVueError

  app.component('Pressable', Pressable)
  app.component('FlatList', FlatList)
  app.component('Swipeable', Swipeable)

  return Object.assign(app, { mount: () => mountOnContainer(rootNode) })
}
