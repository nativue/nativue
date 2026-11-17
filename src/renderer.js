// Custom renderer: instead of the DOM, operations are sent to the native side (globalThis.__native).
import { createRenderer } from '@vue/runtime-core'
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

  patchProp(element, key, _previousValue, nextValue) {
    if (!isEventProp(key)) {
      native.setProp(element.id, key, nextValue ?? null)
      return
    }

    const eventName = key.slice(2).toLowerCase()
    eventHandlersByNodeId[element.id] ??= {}
    eventHandlersByNodeId[element.id][eventName] = nextValue

    native.setProp(element.id, key, nextValue != null)
  },
})

globalThis.__dispatch = (nodeId, eventName, payload) =>
  eventHandlersByNodeId[nodeId]?.[eventName]?.(payload)

const rootNode = { id: 0, type: 'root', parent: null, children: [] }

export function createApp(...args) {
  const app = createBaseApp(...args)
  const mountOnContainer = app.mount
  app.mount = () => mountOnContainer(rootNode)

  return app
}
