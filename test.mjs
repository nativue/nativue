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

const renderedTexts = () =>
  Object.values(viewsById)
    .filter((view) => view.type === 'Text')
    .map((view) => view.text)

const appRootView = viewsById[viewsById[0].children[0]]
const counterView = viewsById[appRootView.children[1]]

assert.equal(appRootView.children.length, 3)
assert.equal(counterView.children.length, 1)
assert.ok(renderedTexts().includes('0'))

const plusButtonId = Object.keys(viewsById).find((id) => viewsById[id].props.title === '+1')
for (let press = 0; press < 3; press++) globalThis.__dispatch(Number(plusButtonId), 'press')
await Promise.resolve()

assert.ok(renderedTexts().includes('3'))
assert.equal(counterView.children.length, 2) // v-if rendered its Text

console.log('ok')
