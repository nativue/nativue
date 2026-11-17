// Runs the bundle against a fake __native and checks the resulting view tree.
import { readFileSync } from 'node:fs'
import assert from 'node:assert'

const viewsById = { 0: { type: 'root', children: [], props: {} } }

function detachEverywhere(childId) {
  for (const view of Object.values(viewsById)) {
    view.children = view.children.filter((id) => id !== childId)
  }
}

globalThis.__native = {
  create: (id, type) => (viewsById[id] = { type, children: [], props: {} }),

  insert: (parentId, childId, index) => {
    detachEverywhere(childId)
    viewsById[parentId].children.splice(index, 0, childId)
  },

  remove: (id) => detachEverywhere(id),

  setProp: (id, key, value) => (viewsById[id].props[key] = value),

  setText: (id, text) => (viewsById[id].text = text),
}

;(0, eval)(readFileSync('ios/VueNative/main.bundle.js', 'utf8'))

// Walks the tree from the root, so removed views don't count.
function renderedTexts(viewId = 0) {
  const view = viewsById[viewId]
  const ownText = view.type === 'Text' ? [view.text] : []

  return [...ownText, ...view.children.flatMap((childId) => renderedTexts(childId))]
}

const safeAreaView = viewsById[viewsById[0].children[0]]
const appRootView = viewsById[safeAreaView.children[0]]
const scrollView = viewsById[appRootView.children[1]]

function pressButton(title, times) {
  const buttonId = Object.keys(viewsById).find((id) => viewsById[id].props.title === title)
  for (let press = 0; press < times; press++) globalThis.__dispatch(Number(buttonId), 'press')
}

assert.equal(safeAreaView.type, 'SafeAreaView')
assert.equal(appRootView.children.length, 3)
assert.equal(scrollView.type, 'ScrollView')
assert.equal(scrollView.children.length, 20)

pressButton('+1', 3)
await Promise.resolve()

assert.equal(scrollView.children.length, 23)
assert.ok(renderedTexts().includes('Item 23'))

pressButton('-1', 5)
await Promise.resolve()

assert.equal(scrollView.children.length, 18)
assert.ok(!renderedTexts().includes('Item 19'))

console.log('ok')
