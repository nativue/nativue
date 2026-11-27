// Custom renderer: instead of the DOM, operations are sent to the native side (globalThis.__native).
import './prelude'
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
import {
  isAccessibilityAttribute,
  withAccessibilityAttribute,
  type AccessibilityAttributes,
} from './accessibility'
import { animatedEventMapping, animatedStyleBinding, isAnimatedEvent } from './animated'
import { Appearance } from './appearance'
import { COLOR_PROPERTIES, processColor } from './colors'
import { FlatListComponent, ImageBackground, Pressable, Swipeable } from './components'
import type { LayoutAnimationConfig, Style } from './types'
export * from '@vue/runtime-core'
export { AccessibilityInfo } from './accessibility'
export type { AccessibilityProps } from './native-components'
export { processColor } from './colors'
export { Animated } from './animated'
export {
  Appearance,
  Dimensions,
  Platform,
  useColorScheme,
  useWindowDimensions,
  type ColorScheme,
  type PlatformOS,
  type WindowSize,
} from './appearance'
export { NativeError, requireNativeFunction } from './native-functions'
export { addNativeListener, AppState, onOpenURL } from './native-events'
export type { AppStateStatus, NativeSubscription } from './native-events'
export { openSettings, usePermission } from './permissions'
export type { PermissionResponse, PermissionResponseWith } from './permissions'
export { AsyncStorage } from './storage'
export type * from './types'

interface Node {
  id: number
  type: string
  parent: Node | null
  children: Node[]
  text: string
  style?: Style | null
  /** <TextInput focused-style>: merged over `style` while the input has focus. */
  focusedStyle?: Style | null
  className?: string
  /** The states its class's styles may depend on (Tailwind's active:, focus:, disabled:). */
  pressed?: boolean
  focused?: boolean
  disabled?: boolean
  classStyle?: Style
  accessibility?: AccessibilityAttributes
  /** <TextInput v-model.trim>: its modifiers, and the text typed last. */
  modelModifiers?: ModelModifiers
  typedText?: string
  /** A drawn view's style from its own props (<svg width height>): under its class and style. */
  baseStyle?: Style
}

/** An element inside a drawn view, or the view itself, as its package sees it. */
export interface DrawnElement {
  readonly id: number
  readonly type: string
  readonly parent: DrawnElement | null
  readonly children: DrawnElement[]
  readonly text: string
}

/**
 * A native view that draws what's inside it, like @nativue/svg's <svg>: its elements stay in JS and
 * never become views. After each batch of changes, the view gets them as one prop, `drawing`.
 */
export interface DrawnView {
  /** The native view's type, e.g. 'Svg', which a package's plugin registers natively. */
  type: string
  /** The tags that create it in a template, e.g. ['svg']. */
  tags: string[]
  /** The tags of the elements drawn inside it, e.g. 'path'. */
  partTags: string[]
  /** Global components, e.g. <Path> for <path>. */
  components?: Record<string, Component>
  /** A part's prop (an @event's handler excepted, which nativue keeps). */
  setPartProp(element: DrawnElement, key: string, value: unknown): void
  /**
   * The view's own prop: true when only the drawing reads it, false when it also goes to the native view.
   * `setBaseStyle` styles the view under its class and style.
   */
  setViewProp(
    element: DrawnElement,
    key: string,
    value: unknown,
    setBaseStyle: (style: Style) => void,
  ): boolean
  /** The view's `drawing`, once per batch of changes; undefined leaves it as it is. */
  drawing(view: DrawnElement, isPressable: (element: DrawnElement) => boolean): unknown
}

type ModelModifiers = { trim?: boolean; number?: boolean; lazy?: boolean }

type ElementState = Pick<Node, 'pressed' | 'focused' | 'disabled'>

type EventHandler = (payload: unknown) => void
type ClassStyleResolver = (className: string, state: Required<ElementState>) => Style

const native = globalThis.__native
let nextNodeId = 1
const eventHandlersByNodeId: Record<number, Record<string, EventHandler | undefined>> = {}
let resolveClassStyle: ClassStyleResolver | null = null
const nodesWithClass = new Set<Node>()
// For their focus state (focus:), which arrives as events by id.
const textInputsById = new Map<number, Node>()

/**
 * Gives `class` its styles, for a nativue.config plugin (@nativue/tailwind). Class styles may depend
 * on the color scheme: they're resolved again when it changes.
 */
export function setClassStyleResolver(resolver: ClassStyleResolver): void {
  resolveClassStyle = resolver
  nodesWithClass.forEach((node) => updateStyle(node, {}))
}

const warnedTags = new Set<string>()

// Native components are capitalized: a lowercase tag is HTML (<div>), or a drawn view's (<svg>) whose
// package isn't installed. Either way it would show nothing.
function warnIfUnknown(tag: string) {
  if (!/^[a-z]/.test(tag) || drawnViewsByTag.has(tag) || warnedTags.has(tag)) return

  warnedTags.add(tag)
  console.warn(
    `<${tag}> isn't a nativue element, so it shows nothing: use nativue's components (<View>, <Text>...), or install the package that provides <${tag}>.`,
  )
}

function createNode(type: string): Node {
  return { id: nextNodeId++, type, parent: null, children: [], text: '' }
}

// What native forgets with a removed subtree: Vue removes only its root.
function nativeIdsIn(node: Node): number[] {
  const ownId = isNativeNode(node) ? [node.id] : []

  return [...ownId, ...node.children.flatMap(nativeIdsIn)]
}

// '#text' and '#comment' nodes only exist in JS (Vue anchors / raw text), and so do a drawn view's
// elements, which the view draws: native never sees them.
function isNativeNode(node: Node): boolean {
  return !node.type.startsWith('#') && !drawnViewsByPartTag.has(node.type)
}

const drawnViewsByTag = new Map<string, DrawnView>()
const drawnViewsByPartTag = new Map<string, DrawnView>()
const drawnViewsByType = new Map<string, DrawnView>()
const drawnViewComponents: Record<string, Component> = {}
const drawnViewsToRedraw = new Set<Node>()

/** For a package's runtime module, before the app starts: see DrawnView. */
export function registerDrawnView(view: DrawnView): void {
  for (const tag of [...view.tags, view.type]) drawnViewsByTag.set(tag, view)
  for (const tag of view.partTags) drawnViewsByPartTag.set(tag, view)
  drawnViewsByType.set(view.type, view)
  Object.assign(drawnViewComponents, view.components)
}

function drawnViewOf(node: Node | null): Node | null {
  let current = node

  while (current && !drawnViewsByType.has(current.type)) current = current.parent

  return current
}

/** Every change inside a drawn view in one batch: the drawing is sent once, after them. */
function redraw(node: Node | null) {
  const view = drawnViewOf(node)
  if (!view) return

  if (drawnViewsToRedraw.size === 0) Promise.resolve().then(sendDrawings)
  drawnViewsToRedraw.add(view)
}

function sendDrawings() {
  const isPressable = (element: DrawnElement) => Boolean(eventHandlersByNodeId[element.id]?.press)
  // Copied first: a drawing that fails doesn't keep the others from being sent next time.
  const views = [...drawnViewsToRedraw]

  drawnViewsToRedraw.clear()
  for (const view of views) {
    const drawing = drawnViewsByType.get(view.type)?.drawing(view, isPressable)

    if (drawing !== undefined) native.setProp(view.id, 'drawing', drawing)
  }
}

/** A drawn view's own props: false for those that go on as for any view. */
function patchDrawnViewProp(element: Node, key: string, value: unknown): boolean {
  const name = camelize(key)

  if (isEventProp(name)) redraw(element)
  if (key === 'style' || key === 'class' || isEventProp(name) || isAccessibilityAttribute(key)) {
    return false
  }

  const setBaseStyle = (style: Style) => {
    const previousStyle = combinedStyle(element)

    element.baseStyle = style
    patchStyle(element, previousStyle, combinedStyle(element))
  }
  const isDrawingOnly = drawnViewsByType
    .get(element.type)!
    .setViewProp(element, key, value, setBaseStyle)

  redraw(element)

  return isDrawingOnly
}

// Vue removes only the root of an unmounted subtree: its descendants go with it.
function forgetSubtree(node: Node) {
  nodesWithClass.delete(node)
  textInputsById.delete(node.id)
  delete eventHandlersByNodeId[node.id]
  node.children.forEach(forgetSubtree)
}

function updateAccessibility(element: Node, key: string, value: unknown) {
  const accessibility = withAccessibilityAttribute(element.accessibility, key, value)
  if (!accessibility) return

  element.accessibility = accessibility
  native.setProp(element.id, 'accessibility', accessibility)
}

// As the native side reads boolean props: a bare attribute (`disabled`) is '', true.
function isTruthyAttribute(value: unknown): boolean {
  return typeof value === 'string' ? value !== 'false' : value === true
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

// The class's styles come first, so the style prop overrides them, as inline styles do on the web.
function combinedStyle(element: Node): Style | null {
  const focusedStyle = element.focused ? element.focusedStyle : null
  if (!element.classStyle && !focusedStyle && !element.baseStyle) return element.style ?? null

  return { ...element.baseStyle, ...element.classStyle, ...element.style, ...focusedStyle }
}

function classStyleOf(element: Node): Style | undefined {
  if (!element.className || !resolveClassStyle) return undefined

  return resolveClassStyle(element.className, {
    pressed: element.pressed ?? false,
    focused: element.focused ?? false,
    disabled: element.disabled ?? false,
  })
}

/** Applies a change to what makes up the style (style, class, state), sending only the diff. */
function updateStyle(
  element: Node,
  change: Pick<Node, 'style' | 'focusedStyle' | 'className'> & ElementState,
) {
  const previousStyle = combinedStyle(element)

  Object.assign(element, change)
  element.classStyle = classStyleOf(element)

  if (element.className) nodesWithClass.add(element)
  else nodesWithClass.delete(element)

  patchStyle(element, previousStyle, combinedStyle(element))
}

Appearance.addChangeListener(() => nodesWithClass.forEach((node) => updateStyle(node, {})))

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

/** Inside a drawn view there's no native view to tell: the drawing says which elements take presses. */
function patchDrawnEventHandler(
  element: Node,
  key: string,
  handler: unknown,
  component: ComponentInternalInstance | null,
) {
  const listener = handler as Function | undefined

  eventHandlersByNodeId[element.id] ??= {}
  eventHandlersByNodeId[element.id][key.slice(2).toLowerCase()] =
    listener &&
    ((payload) =>
      callWithAsyncErrorHandling(listener, component, ErrorCodes.NATIVE_EVENT_HANDLER, [payload]))
  redraw(element)
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
    if (drawnViewsByPartTag.has(type)) return createNode(type)

    const element = createNode(drawnViewsByTag.get(type)?.type ?? type)

    warnIfUnknown(type)
    native.create(element.id, element.type)
    if (type === 'TextInput') textInputsById.set(element.id, element)

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
    redraw(textNode.parent)
  },

  setElementText(element, text) {
    element.children = []
    if (element.type === 'Text') native.setText(element.id, text.trim())
    if (drawnViewsByPartTag.has(element.type)) {
      element.children = [{ ...createNode('#text'), text, parent: element }]
      redraw(element)
    }
  },

  insert(child, parent, anchor) {
    detachFromParent(child) // moving: native repositions the view on insert

    const index = anchor ? parent.children.indexOf(anchor) : parent.children.length
    parent.children.splice(index, 0, child)
    child.parent = parent

    if (isNativeNode(child)) native.insert(parent.id, child.id, nativeIndexBefore(parent, index))
    else syncTextContent(parent)
    redraw(parent)
  },

  remove(child) {
    const parent = detachFromParent(child)
    forgetSubtree(child)

    if (isNativeNode(child)) native.remove(child.id, nativeIdsIn(child))
    else syncTextContent(parent)
    redraw(parent)
  },

  parentNode(node) {
    return node.parent
  },

  nextSibling(node) {
    const siblings = node.parent?.children

    return siblings?.[siblings.indexOf(node) + 1] ?? null
  },

  patchProp(element, key, previousValue, nextValue, _namespace, component) {
    const drawnView = drawnViewsByPartTag.get(element.type)

    if (drawnView) {
      if (isEventProp(camelize(key))) {
        patchDrawnEventHandler(element, camelize(key), nextValue, component ?? null)
      } else {
        drawnView.setPartProp(element, key, nextValue)
        redraw(element)
      }
    } else if (drawnViewsByType.has(element.type) && patchDrawnViewProp(element, key, nextValue)) {
      return
    } else if (key === 'style') updateStyle(element, { style: nextValue })
    else if (key === 'class') updateStyle(element, { className: nextValue ?? undefined })
    else if (key === 'pressed') updateStyle(element, { pressed: nextValue })
    else if (isAccessibilityAttribute(key)) updateAccessibility(element, key, nextValue)
    else if (camelize(key) === 'focusedStyle') updateStyle(element, { focusedStyle: nextValue })
    else if (key === 'disabled') {
      updateStyle(element, { disabled: isTruthyAttribute(nextValue) })
      native.setProp(element.id, key, nextValue ?? null)
    }
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
  // A press on a drawn view's elements: the innermost first, then the groups around it.
  if (eventName === 'elementpress') {
    const { nodeIds, ...location } = payload as { nodeIds: number[] }

    return nodeIds.forEach((id) => eventHandlersByNodeId[id]?.press?.(location))
  }

  updateFocus(nodeId, eventName)

  const handlers = eventHandlersByNodeId[nodeId]
  if (!handlers) return

  handlers[eventName]?.(payload)
  updateModel(nodeId, eventName, payload, handlers['update:modelvalue'])
}

// One call per layout pass: the handlers' changes then render together, once.
globalThis.__layoutsChanged = (layouts) => {
  for (const { id, ...layout } of layouts) globalThis.__dispatch(id, 'layout', layout)
}

// v-model's modifiers, as on the web: .lazy updates when editing ends rather than on every keystroke;
// .trim and .number change the value the model gets.
function updateModel(nodeId: number, eventName: string, payload: unknown, update?: EventHandler) {
  const textInput = textInputsById.get(nodeId)
  if (textInput && eventName === 'changetext') textInput.typedText = payload as string
  if (!update) return

  const modifiers = textInput?.modelModifiers ?? {}
  if (!modifiers.lazy) {
    if (MODEL_EVENT_BY_NATIVE_EVENT[eventName]) update(modelValue(modifiers, payload))
    return
  }

  const editingEnded = eventName === 'blur' || eventName === 'submitediting'
  const typedText = textInput?.typedText
  if (editingEnded && typedText !== undefined) update(modelValue(modifiers, typedText))
}

function modelValue(modifiers: ModelModifiers, value: unknown): unknown {
  if (typeof value !== 'string') return value

  const text = modifiers.trim ? value.trim() : value
  if (!modifiers.number) return text

  const number = parseFloat(text)

  return Number.isNaN(number) ? text : number
}

// A <TextInput>'s focus, for its class's focus: styles and its focused-style.
function updateFocus(nodeId: number, eventName: string) {
  const textInput = textInputsById.get(nodeId)
  if (!textInput || (eventName !== 'focus' && eventName !== 'blur')) return

  updateStyle(textInput, { focused: eventName === 'focus' })
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

export const Keyboard = {
  dismiss(): void {
    native.dismissKeyboard()
  },
}

// Replaces Vue's DOM-only vModelText, which the template compiler emits for v-model on
// <TextInput> and <Switch>.
export const vModelText: Directive<Node> = {
  created(element, { value, modifiers }) {
    element.modelModifiers = modifiers
    native.setProp(element.id, 'value', nativeModelValue(value))
  },

  beforeUpdate(element, { value, oldValue, modifiers }) {
    if (value === oldValue || showsModelValue(element, value, modifiers)) return

    native.setProp(element.id, 'value', nativeModelValue(value))
  },
}

// The field keeps what was typed when it already gives the model's value: with .trim, "hello " stays
// as typed instead of losing its space mid-word.
function showsModelValue(element: Node, value: unknown, modifiers: ModelModifiers): boolean {
  return element.typedText !== undefined && modelValue(modifiers, element.typedText) === value
}

// A <TextInput> shows text, so a v-model.number's number goes as text; a <Switch> takes its boolean.
function nativeModelValue(value: unknown): unknown {
  return typeof value === 'number' ? String(value) : (value ?? '')
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
  app.component('FlatList', FlatListComponent)
  app.component('Swipeable', Swipeable)
  app.component('ImageBackground', ImageBackground)
  for (const [name, component] of Object.entries(drawnViewComponents))
    app.component(name, component)

  return Object.assign(app, { mount: () => mountOnContainer(rootNode) })
}
