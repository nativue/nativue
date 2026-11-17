// Custom renderer: instead of the DOM, operations are sent to the native side (globalThis.__native).
import { camelize, createRenderer } from '@vue/runtime-core'
import { COLOR_PROPERTIES, processColor } from './colors.js'
import { FlatList, Pressable } from './components.js'
export * from '@vue/runtime-core'

const native = globalThis.__native
let nextNodeId = 1
// ponytail: handlers of removed nodes are never cleaned up; clean them on remove when it matters.
const eventHandlersByNodeId = {}

function createNode(type) {
  return { id: nextNodeId++, type, parent: null, children: [], text: '' }
}

// '#text' and '#comment' nodes only exist in JS (Vue anchors / raw text); native never sees them.
function isNativeNode(node) {
  return !node.type.startsWith('#')
}

function isEventProp(key) {
  return /^on[A-Z]/.test(key)
}

// Raw text inside <Text> becomes the text of the parent label (like RCTRawText in React Native).
function syncTextContent(parent) {
  if (parent?.type !== 'Text') return

  const text = parent.children.map((child) => child.text).join('')
  native.setText(parent.id, text)
}

function detachFromParent(node) {
  const parent = node.parent
  if (!parent) return null

  parent.children.splice(parent.children.indexOf(node), 1)
  node.parent = null

  return parent
}

function nativeIndexBefore(parent, childIndex) {
  return parent.children.slice(0, childIndex).filter(isNativeNode).length
}

function nativeStyleValue(property, value) {
  return COLOR_PROPERTIES.has(property) ? processColor(value) : value
}

// Only changed properties cross the bridge; removed ones are sent as null.
function styleChanges(previousStyle = {}, nextStyle = {}) {
  const changes = {}

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

function patchStyle(element, previousStyle, nextStyle) {
  const changes = styleChanges(previousStyle ?? {}, nextStyle ?? {})
  if (Object.keys(changes).length === 0) return

  native.setProp(element.id, 'style', changes)
}

// <Image :source="logo" /> or :source="{ uri }", like React Native.
function nativePropValue(key, value) {
  return key === 'source' ? (value?.uri ?? value) : value
}

function patchEventHandler(element, key, handler) {
  const eventName = key.slice(2).toLowerCase()
  eventHandlersByNodeId[element.id] ??= {}
  eventHandlersByNodeId[element.id][eventName] = handler

  native.setProp(element.id, key, handler != null)
}

const { createApp: createBaseApp } = createRenderer({
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
    if (element.type === 'Text') native.setText(element.id, text)
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

  patchProp(element, key, previousValue, nextValue) {
    if (key === 'style') patchStyle(element, previousValue, nextValue)
    else if (isEventProp(key)) patchEventHandler(element, key, nextValue)
    else native.setProp(element.id, camelize(key), nativePropValue(key, nextValue) ?? null) // keyboard-type -> keyboardType
  },
})

// v-model compiles to an "onUpdate:modelValue" handler; it listens to the same native event as @changeText.
const MODEL_EVENT_BY_NATIVE_EVENT = { changetext: 'update:modelvalue' }

globalThis.__dispatch = (nodeId, eventName, payload) => {
  const handlers = eventHandlersByNodeId[nodeId]
  if (!handlers) return

  handlers[eventName]?.(payload)
  handlers[MODEL_EVENT_BY_NATIVE_EVENT[eventName]]?.(payload)
}

export const Keyboard = {
  dismiss() {
    native.dismissKeyboard()
  },
}

// Replaces Vue's DOM-only vModelText, which the template compiler emits for v-model on <TextInput>.
// ponytail: v-model modifiers (.trim, .number, .lazy) are not supported yet.
export const vModelText = {
  created(element, { value }) {
    native.setProp(element.id, 'value', value ?? '')
  },

  beforeUpdate(element, { value, oldValue }) {
    if (value !== oldValue) native.setProp(element.id, 'value', value ?? '')
  },
}

const rootNode = { id: 0, type: 'root', parent: null, children: [] }

export function createApp(...args) {
  const app = createBaseApp(...args)
  const mountOnContainer = app.mount

  app.component('Pressable', Pressable)
  app.component('FlatList', FlatList)
  app.mount = () => mountOnContainer(rootNode)

  return app
}
