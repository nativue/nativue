// Custom renderer: em vez do DOM, manda operações para o lado nativo (globalThis.__native).
import { createRenderer } from '@vue/runtime-core'
export * from '@vue/runtime-core'

const N = globalThis.__native
let nextId = 1
// ponytail: handlers de nós removidos nunca são limpos; limpar no remove quando importar.
const handlers = {}

const node = (type) => ({ id: nextId++, type, parent: null, children: [], text: '' })
// '#text' e '#comment' só existem no JS (âncoras do Vue / texto cru); o nativo nunca os vê.
const isNative = (n) => n.type[0] !== '#'

// Texto cru dentro de <text> vira a propriedade text do UILabel pai (igual RCTRawText no RN).
function syncText(parent) {
  if (parent?.type === 'text') N.setText(parent.id, parent.children.map((c) => c.text).join(''))
}

function detach(child) {
  const p = child.parent
  if (!p) return null
  p.children.splice(p.children.indexOf(child), 1)
  child.parent = null
  return p
}

const { createApp: baseCreateApp } = createRenderer({
  createElement(type) {
    const n = node(type)
    N.create(n.id, type)
    return n
  },
  createText(text) {
    const n = node('#text')
    n.text = text
    return n
  },
  createComment: () => node('#comment'),
  setText(n, text) {
    n.text = text
    syncText(n.parent)
  },
  setElementText(el, text) {
    el.children = []
    if (el.type === 'text') N.setText(el.id, text)
  },
  insert(child, parent, anchor) {
    detach(child) // move: o nativo reposiciona sozinho no insert
    const i = anchor ? parent.children.indexOf(anchor) : parent.children.length
    parent.children.splice(i, 0, child)
    child.parent = parent
    if (isNative(child)) N.insert(parent.id, child.id, parent.children.slice(0, i).filter(isNative).length)
    else syncText(parent)
  },
  remove(child) {
    const p = detach(child)
    if (isNative(child)) N.remove(child.id)
    else syncText(p)
  },
  parentNode: (n) => n.parent,
  nextSibling: (n) => n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
  patchProp(el, key, prev, next) {
    if (/^on[A-Z]/.test(key)) {
      ;(handlers[el.id] ||= {})[key.slice(2).toLowerCase()] = next
      N.setProp(el.id, key, next != null)
    } else {
      N.setProp(el.id, key, next ?? null)
    }
  },
})

globalThis.__dispatch = (id, event, payload) => handlers[id]?.[event]?.(payload)

const root = { id: 0, type: 'root', parent: null, children: [] }

export function createApp(...args) {
  const app = baseCreateApp(...args)
  const mount = app.mount
  app.mount = () => mount(root)
  return app
}
