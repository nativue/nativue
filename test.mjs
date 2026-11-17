// Runs the bundle against a fake __native and checks the resulting view tree.
import { readFileSync } from 'node:fs'
import assert from 'node:assert'
import { processColor } from './src/colors.js'

const viewsById = { 0: { type: 'root', children: [], props: {} } }
let keyboardDismissCount = 0

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

  dismissKeyboard: () => keyboardDismissCount++,
}

;(0, eval)(readFileSync('ios/VueNative/main.bundle.js', 'utf8'))

// Walks the tree from the root, so removed views don't count.
function renderedTexts(viewId = 0) {
  const view = viewsById[viewId]
  const ownText = view.type === 'Text' ? [view.text] : []

  return [...ownText, ...view.children.flatMap((childId) => renderedTexts(childId))]
}

function findViewId(predicate) {
  return Number(Object.keys(viewsById).find((id) => predicate(viewsById[id])))
}

function pressButton(title, times = 1) {
  const buttonId = findViewId((view) => view.props.title === title)
  for (let press = 0; press < times; press++) globalThis.__dispatch(buttonId, 'press')
}

const safeAreaView = viewsById[viewsById[0].children[0]]
const scrollView = viewsById[findViewId((view) => view.type === 'ScrollView')]
const textInputId = findViewId((view) => view.type === 'TextInput')

assert.equal(safeAreaView.type, 'SafeAreaView')
assert.equal(scrollView.children.length, 20)
assert.equal(viewsById[textInputId].props.value, '')
assert.equal(scrollView.props.keyboardDismissMode, 'interactive') // kebab-case attribute arrives camelized

// Typing updates v-model; adding pushes the typed text and clears the input.
globalThis.__dispatch(textInputId, 'changetext', 'Comprar pão')
pressButton('Adicionar')
await Promise.resolve()

assert.equal(scrollView.children.length, 21)
assert.ok(renderedTexts().includes('Comprar pão'))
assert.equal(viewsById[textInputId].props.value, '')

// Return key (submitEditing) adds too.
globalThis.__dispatch(textInputId, 'changetext', 'Pagar contas')
globalThis.__dispatch(textInputId, 'submitediting', 'Pagar contas')
await Promise.resolve()

assert.ok(renderedTexts().includes('Pagar contas'))

pressButton('Remover último', 2)
await Promise.resolve()

assert.equal(scrollView.children.length, 20)
assert.ok(!renderedTexts().includes('Pagar contas'))
assert.equal(keyboardDismissCount, 2)

assert.equal(processColor('red'), 0xff0000ff)
assert.equal(processColor('#42b883'), 0x42b883ff)
assert.equal(processColor('#f80'), 0xff8800ff)
assert.equal(processColor('#ff000080'), 0xff000080)
assert.equal(processColor('rgba(255, 0, 0, 0.5)'), 0xff000080)
assert.equal(processColor('rgb(0, 128, 255)'), 0x0080ffff)
assert.equal(processColor('transparent'), 0x00000000)
assert.equal(processColor('not-a-color'), null)

console.log('ok')
