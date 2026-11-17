// Runs the bundle against a fake __native and checks the resulting view tree.
import { readFileSync } from 'node:fs'
import assert from 'node:assert'
import { processColor } from './src/colors.js'

const ITEM_HEIGHT = 60
const viewsById = { 0: { type: 'root', children: [], props: {}, style: {} } }
let keyboardDismissCount = 0

function detachEverywhere(childId) {
  for (const view of Object.values(viewsById)) {
    view.children = view.children.filter((id) => id !== childId)
  }
}

globalThis.__native = {
  create: (id, type) => (viewsById[id] = { type, children: [], props: {}, style: {} }),

  insert: (parentId, childId, index) => {
    detachEverywhere(childId)
    viewsById[parentId].children.splice(index, 0, childId)
  },

  remove: (id) => detachEverywhere(id),

  // Style arrives as a diff, so merge it like the native side does.
  setProp: (id, key, value) => {
    if (key === 'style') Object.assign(viewsById[id].style, value)
    else viewsById[id].props[key] = value
  },

  setText: (id, text) => (viewsById[id].text = text),

  dismissKeyboard: () => keyboardDismissCount++,
}

;(0, eval)(readFileSync('ios/VueNative/main.bundle.js', 'utf8'))

// Walks the tree from the root, so removed views don't count.
function renderedViewIds(viewId = 0) {
  return [viewId, ...viewsById[viewId].children.flatMap((childId) => renderedViewIds(childId))]
}

function renderedTexts() {
  return renderedViewIds()
    .map((id) => viewsById[id])
    .filter((view) => view.type === 'Text')
    .map((view) => view.text)
}

function findViewId(predicate) {
  return renderedViewIds().find((id) => predicate(viewsById[id]))
}

function pressButton(title, times = 1) {
  const buttonId = findViewId((view) => view.props.title === title)
  for (let press = 0; press < times; press++) globalThis.__dispatch(buttonId, 'press')
}

function scrollList(y, height = 600) {
  globalThis.__dispatch(scrollViewId, 'scroll', { x: 0, y, width: 300, height })
}

// The rows container is the ScrollView child carrying the windowing padding.
function listWindow() {
  return viewsById[scrollView.children.find((id) => 'paddingTop' in viewsById[id].style)]
}

function renderedRows() {
  return listWindow().children.length
}

function pressableShowing(text) {
  return findViewId(
    (view) =>
      view.type === 'PressableView' &&
      view.children.some((childId) => viewsById[childId].text?.endsWith(text)),
  )
}

const settle = () => new Promise((resolve) => setTimeout(resolve))

const safeAreaView = viewsById[viewsById[0].children[0]]
const scrollViewId = findViewId((view) => view.type === 'ScrollView')
const scrollView = viewsById[scrollViewId]
const textInputId = findViewId((view) => view.type === 'TextInput')
const image = viewsById[findViewId((view) => view.type === 'Image')]

assert.equal(safeAreaView.type, 'SafeAreaView')
assert.equal(viewsById[textInputId].props.value, '')
assert.match(image.props.source, /^data:image\/png;base64,/) // imported asset is inlined
assert.equal(image.props.resizeMode, 'contain') // kebab-case attribute arrives camelized
assert.equal(scrollView.props.onScroll, true)

// FlatList renders a window of rows; the rest is padding.
assert.equal(renderedRows(), 10)

scrollList(6000)
await settle()

assert.equal(renderedRows(), 30)
assert.equal(listWindow().style.paddingTop, 90 * ITEM_HEIGHT)
assert.equal(listWindow().style.paddingBottom, (1000 - 120) * ITEM_HEIGHT)
assert.ok(renderedTexts().includes('Item 101'))
assert.ok(!renderedTexts().includes('Item 1'))

scrollList(0)
await settle()

// Bouncing past the top reports a negative offset; the window must stay put.
const rowsAtTop = renderedRows()
scrollList(-150)
await settle()
assert.equal(renderedRows(), rowsAtTop)

// Pressable: pressed-style applies while pressed; press toggles, long press removes.

const firstRowId = pressableShowing('Item 1')
globalThis.__dispatch(firstRowId, 'pressin')
await settle()
assert.equal(viewsById[firstRowId].style.opacity, 0.5)

globalThis.__dispatch(firstRowId, 'pressout')
globalThis.__dispatch(firstRowId, 'press')
await settle()
assert.equal(viewsById[firstRowId].style.opacity, null) // removed: native resets it
assert.equal(viewsById[firstRowId].style.backgroundColor, processColor('#d8f3e6'))
assert.ok(renderedTexts().includes('✓ Item 1'))

globalThis.__dispatch(pressableShowing('Item 2'), 'longpress')
await settle()
assert.ok(!renderedTexts().includes('Item 2'))
assert.ok(renderedTexts().includes('999 itens'))

// Typing updates v-model; adding appends the typed text and clears the input.
globalThis.__dispatch(textInputId, 'changetext', 'Comprar pão')
pressButton('Adicionar')
await settle()

assert.equal(viewsById[textInputId].props.value, '')
assert.ok(renderedTexts().includes('1000 itens'))

scrollList(1000 * ITEM_HEIGHT - 600)
await settle()
assert.ok(renderedTexts().includes('Comprar pão'))

// Return key (submitEditing) adds too.
globalThis.__dispatch(textInputId, 'changetext', 'Pagar contas')
globalThis.__dispatch(textInputId, 'submitediting', 'Pagar contas')
await settle()
assert.ok(renderedTexts().includes('Pagar contas'))

pressButton('Remover último', 2)
await settle()

assert.ok(renderedTexts().includes('999 itens'))
assert.ok(!renderedTexts().includes('Pagar contas'))
assert.equal(keyboardDismissCount, 2)

// Header and footer slots render around the rows.
assert.ok(renderedTexts().includes('Puxe para atualizar'))
assert.ok(renderedTexts().includes('Fim da lista'))

// Pull to refresh: refreshing turns on, then the timer reloads the list and turns it off.
globalThis.__dispatch(scrollViewId, 'refresh')
await settle()
assert.equal(scrollView.props.refreshing, true)

await new Promise((resolve) => setTimeout(resolve, 900))
assert.equal(scrollView.props.refreshing, false)
assert.ok(renderedTexts().includes('1000 itens'))

// Empty slot shows once every item is gone.
pressButton('Remover último', 1000)
await settle()
assert.ok(renderedTexts().includes('Nenhum item'))

assert.equal(processColor('red'), 0xff0000ff)
assert.equal(processColor('#42b883'), 0x42b883ff)
assert.equal(processColor('#f80'), 0xff8800ff)
assert.equal(processColor('#ff000080'), 0xff000080)
assert.equal(processColor('rgba(255, 0, 0, 0.5)'), 0xff000080)
assert.equal(processColor('rgb(0, 128, 255)'), 0x0080ffff)
assert.equal(processColor('transparent'), 0x00000000)
assert.equal(processColor('not-a-color'), null)

console.log('ok')
