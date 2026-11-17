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

// Page options and the <Tabs.Screen> order apply on the next tick (JavaScriptCore drains it before
// handing the batch to native).
await new Promise((resolve) => setTimeout(resolve))

// ---------- Helpers ----------

// Walks the tree from a view, so removed views don't count.
function renderedViewIds(viewId = 0) {
  return [viewId, ...viewsById[viewId].children.flatMap((childId) => renderedViewIds(childId))]
}

function renderedTexts(viewId = 0) {
  return renderedViewIds(viewId)
    .map((id) => viewsById[id])
    .filter((view) => view.type === 'Text')
    .map((view) => view.text)
}

function findViewId(predicate, rootId = 0) {
  const viewId = renderedViewIds(rootId).find((id) => predicate(viewsById[id]))
  assert.ok(viewId !== undefined, `no rendered view matches ${predicate}`)

  return viewId
}

function press(viewId, eventName = 'press') {
  globalThis.__dispatch(viewId, eventName)
}

function pressButton(title, times = 1, rootId = 0) {
  const buttonId = findViewId(
    (view) => view.type === 'Button' && view.props.title === title,
    rootId,
  )
  for (let count = 0; count < times; count++) press(buttonId)
}

const settle = () => new Promise((resolve) => setTimeout(resolve))

const childScreenIds = (containerId) =>
  viewsById[containerId].children.filter((id) => viewsById[id].type === 'Screen')
// Excludes the root itself: a tab's own <Screen> is not the screen inside it.
function descendantOfType(rootId, type) {
  return findViewId((view) => view.type === type && view !== viewsById[rootId], rootId)
}

const rootStackId = viewsById[0].children[0]
const rootScreenIds = () => childScreenIds(rootStackId)
const topRootScreenId = () => rootScreenIds().at(-1)

const tabBarId = findViewId((view) => view.type === 'TabBar')
const tabBar = viewsById[tabBarId]
const tabScreenIds = () => childScreenIds(tabBarId)
const [listTabId, exploreTabId, settingsTabId] = tabScreenIds()
const exploreStackId = descendantOfType(exploreTabId, 'ScreenStack')

const scrollViewId = findViewId((view) => view.type === 'ScrollView')
const scrollView = viewsById[scrollViewId]
const textInputId = findViewId((view) => view.type === 'TextInput')

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

function pressableShowing(text, rootId = 0) {
  return findViewId(
    (view) =>
      view.type === 'PressableView' &&
      view.children.some((childId) => viewsById[childId].text?.endsWith(text)),
    rootId,
  )
}

function selectTab(index) {
  globalThis.__dispatch(tabBarId, 'tabchange', { index })
}

// ---------- Router: layouts, tabs and headers ----------

assert.equal(viewsById[rootStackId].type, 'ScreenStack')
assert.equal(rootScreenIds().length, 1)
assert.equal(viewsById[rootScreenIds()[0]].props.headerShown, false) // (tabs) brings its own headers

assert.deepEqual(
  tabScreenIds().map((id) => viewsById[id].props.tabBarItem),
  [
    { label: 'Lista', systemImage: 'list.bullet', badge: undefined },
    { label: 'Explorar', systemImage: 'safari', badge: undefined },
    { label: 'Ajustes', systemImage: 'gearshape', badge: undefined },
  ],
)
assert.equal(tabBar.props.selectedIndex, 0)

// A page tab gets a single-screen stack for its header.
const listScreen = viewsById[descendantOfType(listTabId, 'Screen')]
assert.equal(listScreen.props.title, 'Vue Native') // title from <Tabs.Screen>
assert.equal(listScreen.props.headerShown, true)

// ---------- Components on the list tab ----------

const image = viewsById[findViewId((view) => view.type === 'Image')]
assert.match(image.props.source, /^data:image\/png;base64,/) // imported asset is inlined
assert.equal(image.props.resizeMode, 'contain') // kebab-case attribute arrives camelized
assert.equal(viewsById[textInputId].props.value, '')

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

assert.ok(renderedTexts().includes('Puxe para atualizar')) // #header slot
assert.ok(renderedTexts().includes('Fim da lista')) // #footer slot

// ---------- Root stack: push over the tabs, params, Link, native pop, back ----------

const firstRowId = pressableShowing('Item 1')
press(firstRowId, 'pressin')
await settle()
assert.equal(viewsById[firstRowId].style.opacity, 0.5) // pressed-style

press(firstRowId, 'pressout')
press(firstRowId)
await settle()
assert.equal(viewsById[firstRowId].style.opacity, null) // removed: native resets it

assert.equal(rootScreenIds().length, 2)
const detailScreen = viewsById[topRootScreenId()]
assert.equal(detailScreen.props.title, 'Item 1') // set by the page from useLocalSearchParams().id
assert.equal(detailScreen.props.headerBackTitle, 'Lista')
assert.equal(detailScreen.props.headerTintColor, processColor('#42b883')) // root screenOptions

// Switch v-model on the detail page marks the item done; the list tab shows a badge.
globalThis.__dispatch(descendantOfType(topRootScreenId(), 'Switch'), 'valuechange', true)
await settle()
assert.ok(renderedTexts(listTabId).includes('✓ Item 1'))
assert.equal(viewsById[listTabId].props.tabBarItem.badge, 1)

// <Link> pushes the next item.
press(descendantOfType(topRootScreenId(), 'PressableView'))
await settle()
assert.equal(rootScreenIds().length, 3)
assert.equal(viewsById[topRootScreenId()].props.title, 'Item 2')

// Back button / edge swipe: native pops and reports it.
globalThis.__dispatch(topRootScreenId(), 'dismissed')
await settle()
assert.equal(rootScreenIds().length, 2)

// Deleting goes back (router.back()).
pressButton('Excluir item', 1, topRootScreenId())
await settle()
assert.equal(rootScreenIds().length, 1)
assert.ok(!renderedTexts().includes('✓ Item 1'))
assert.ok(renderedTexts().includes('999 itens'))
assert.equal(viewsById[listTabId].props.tabBarItem.badge, undefined)

// ---------- Tabs with a nested stack ----------

selectTab(1)
await settle()
assert.equal(tabBar.props.selectedIndex, 1)
assert.equal(childScreenIds(exploreStackId).length, 1)
assert.equal(viewsById[childScreenIds(exploreStackId)[0]].props.title, 'Explorar')

press(pressableShowing('componentes ›', exploreTabId))
await settle()
assert.equal(childScreenIds(exploreStackId).length, 2) // pushed inside the tab
assert.equal(viewsById[childScreenIds(exploreStackId)[1]].props.title, 'componentes')
assert.equal(rootScreenIds().length, 1)

press(descendantOfType(childScreenIds(exploreStackId)[1], 'PressableView')) // <Link href="/items/1" push>
await settle()
assert.equal(rootScreenIds().length, 2) // over the tabs
globalThis.__dispatch(topRootScreenId(), 'dismissed')
await settle()

globalThis.__openURL('vuenative://explore') // navigate: back to the tab's first screen
await settle()
assert.equal(childScreenIds(exploreStackId).length, 1)

// ---------- List editing ----------

selectTab(0)
press(pressableShowing('Item 2'), 'longpress')
await settle()
assert.ok(!renderedTexts().includes('Item 2'))
assert.ok(renderedTexts().includes('998 itens'))

// Typing updates v-model; adding appends the typed text and clears the input.
globalThis.__dispatch(textInputId, 'changetext', 'Comprar pão')
pressButton('Adicionar')
await settle()
assert.equal(viewsById[textInputId].props.value, '')
assert.ok(renderedTexts().includes('999 itens'))

scrollList(999 * ITEM_HEIGHT - 600)
await settle()
assert.ok(renderedTexts().includes('Comprar pão'))

// Return key (submitEditing) adds too.
globalThis.__dispatch(textInputId, 'changetext', 'Pagar contas')
globalThis.__dispatch(textInputId, 'submitediting', 'Pagar contas')
await settle()
assert.ok(renderedTexts().includes('Pagar contas'))

// ---------- Settings tab: buttons and modal ----------

const focusCountText = (count) => `Vezes que esta aba ganhou foco: ${count}`
assert.ok(renderedTexts(settingsTabId).includes(focusCountText(0)))

selectTab(2)
await settle()
assert.equal(tabBar.props.selectedIndex, 2)
assert.ok(renderedTexts(settingsTabId).includes(focusCountText(1))) // useFocusEffect

pressButton('Remover último', 2, settingsTabId)
await settle()
assert.ok(renderedTexts().includes('998 itens'))
assert.ok(!renderedTexts().includes('Pagar contas'))
assert.equal(keyboardDismissCount, 2)

const modal = viewsById[descendantOfType(settingsTabId, 'Modal')]
pressButton('Sobre', 1, settingsTabId)
await settle()
assert.equal(modal.props.visible, true)

globalThis.__dispatch(
  findViewId((view) => view === modal),
  'requestclose',
) // sheet swiped down
await settle()
assert.equal(modal.props.visible, false)

// ---------- Modal route ----------

press(pressableShowing('Abrir rota modal ›', settingsTabId)) // <Link href="/about">
await settle()
assert.equal(rootScreenIds().length, 2)
assert.equal(viewsById[topRootScreenId()].props.stackPresentation, 'modal') // from the root layout
assert.equal(viewsById[topRootScreenId()].props.title, 'Sobre')

press(descendantOfType(topRootScreenId(), 'PressableView')) // pushed after the modal: opens inside it
await settle()
assert.equal(rootScreenIds().length, 3)
assert.equal(viewsById[topRootScreenId()].props.stackPresentation, 'push')

globalThis.__dispatch(rootScreenIds()[1], 'dismissed') // sheet swiped down takes both
globalThis.__dispatch(topRootScreenId(), 'dismissed')
await settle()
assert.equal(rootScreenIds().length, 1)

press(pressableShowing('Abrir rota modal ›', settingsTabId))
await settle()
globalThis.__dispatch(topRootScreenId(), 'headeritempress', { side: 'right', index: 0 }) // Fechar
await settle()
assert.equal(rootScreenIds().length, 1)
assert.ok(renderedTexts(settingsTabId).includes(focusCountText(3))) // refocused after each modal

// ---------- Deep links and not found ----------

globalThis.__openURL('vuenative://items/3')
await settle()
assert.equal(viewsById[topRootScreenId()].props.title, 'Item 3')

globalThis.__dispatch(descendantOfType(topRootScreenId(), 'Switch'), 'valuechange', true)
globalThis.__openURL('vuenative://') // pops back to the tabs and selects the list tab
await settle()
assert.equal(rootScreenIds().length, 1)
assert.equal(tabBar.props.selectedIndex, 0)

// The settings switch hides done items.
scrollList(0)
await settle()
const hideSwitchId = descendantOfType(settingsTabId, 'Switch')
assert.ok(renderedTexts().includes('✓ Item 3'))

globalThis.__dispatch(hideSwitchId, 'valuechange', true)
await settle()
assert.ok(!renderedTexts().includes('✓ Item 3'))
assert.ok(renderedTexts().includes('Item 4'))

globalThis.__dispatch(hideSwitchId, 'valuechange', false)
await settle()

globalThis.__openURL('vuenative://does/not/exist')
await settle()
assert.equal(viewsById[topRootScreenId()].props.title, 'Ops!')
assert.ok(renderedTexts(topRootScreenId()).includes('Essa tela não existe.'))

press(descendantOfType(topRootScreenId(), 'PressableView')) // <Link href="/">
await settle()
assert.equal(rootScreenIds().length, 1)

// ---------- Pull to refresh and empty list ----------

globalThis.__dispatch(scrollViewId, 'refresh')
await settle()
assert.equal(scrollView.props.refreshing, true)
assert.equal(
  viewsById[findViewId((view) => view.type === 'ActivityIndicator')].props.color,
  0x8e8e93ff,
)

await new Promise((resolve) => setTimeout(resolve, 900))
assert.equal(scrollView.props.refreshing, false)
assert.ok(renderedTexts().includes('1000 itens'))

pressButton('Remover último', 1000, settingsTabId)
await settle()
assert.ok(renderedTexts().includes('Nenhum item'))

// ---------- Colors ----------

assert.equal(processColor('red'), 0xff0000ff)
assert.equal(processColor('#42b883'), 0x42b883ff)
assert.equal(processColor('#f80'), 0xff8800ff)
assert.equal(processColor('#ff000080'), 0xff000080)
assert.equal(processColor('rgba(255, 0, 0, 0.5)'), 0xff000080)
assert.equal(processColor('rgb(0, 128, 255)'), 0x0080ffff)
assert.equal(processColor('transparent'), 0x00000000)
assert.equal(processColor('not-a-color'), null)

console.log('ok')
