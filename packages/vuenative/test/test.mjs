// Runs the demo app's bundle against a fake __native and checks the resulting view tree.
import { readFileSync } from 'node:fs'
import assert from 'node:assert'
import { processColor } from '../src/colors.ts'

const ITEM_HEIGHT = 60
const viewsById = { 0: { type: 'root', children: [], props: {}, style: {} } }
let keyboardDismissCount = 0
const layoutAnimations = []
const animated = { nodes: {}, started: [], stopped: [], styles: {}, events: {} }
const storage = new Map()
const fetchRequests = []
const POSTS = [
  { id: 1, title: 'Primeiro post' },
  { id: 2, title: 'Segundo post' },
]

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
  configureNextLayoutAnimation: (config) => layoutAnimations.push(config),

  createAnimatedNode: (id, config) => (animated.nodes[id] = config),
  setAnimatedValue: (id, value) => (animated.nodes[id].value = value),
  startAnimation: (animationId, nodeId, config) => animated.started.push({ nodeId, ...config }),
  stopAnimation: (nodeId) => animated.stopped.push(nodeId),
  setAnimatedStyle: (viewId, binding) => (animated.styles[viewId] = binding),
  setAnimatedEvent: (viewId, event, mapping) => ((animated.events[viewId] ??= {})[event] = mapping),

  storageGet: (key) => storage.get(key) ?? null,
  storageSet: (key, value) => storage.set(key, value),
  storageRemove: (key) => storage.delete(key),
  storageKeys: () => [...storage.keys()],
  storageClear: () => storage.clear(),

  // Answers like URLSession would, on a later turn.
  fetch: (requestId, url, method, headers, body) => {
    fetchRequests.push({ url, method, headers, body })
    const response = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(POSTS),
    }
    setTimeout(() => globalThis.__fetchFinished(requestId, response, null))
  },
}

;(0, eval)(
  readFileSync(new URL('../../../examples/demo/ios/App/main.bundle.js', import.meta.url), 'utf8'),
)

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
const exploreStackId = () => descendantOfType(exploreTabId, 'ScreenStack') // lazy tab

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
assert.deepEqual(layoutAnimations.at(-1), { type: 'spring', duration: 700, springDamping: 0.4 })
const badge = viewsById[findViewId((view) => view.style.transform !== undefined, topRootScreenId())]
assert.deepEqual(badge.style.transform, [{ scale: 1.15 }, { rotate: '-4deg' }])
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

// Lazy tab: nothing mounted until opened; a deep link before that still stacks on its first screen.
assert.equal(viewsById[exploreTabId].children.length, 0)

globalThis.__openURL('vuenative://explore/navegacao')
await settle()
assert.equal(tabBar.props.selectedIndex, 1)
assert.deepEqual(
  childScreenIds(exploreStackId()).map((id) => viewsById[id].props.title),
  ['Explorar', 'navegacao'],
)

globalThis.__openURL('vuenative://explore')
await settle()
selectTab(1)
await settle()
assert.equal(tabBar.props.selectedIndex, 1)
assert.equal(childScreenIds(exploreStackId()).length, 1)
assert.equal(viewsById[childScreenIds(exploreStackId())[0]].props.title, 'Explorar')

press(pressableShowing('componentes ›', exploreTabId))
await settle()
assert.equal(childScreenIds(exploreStackId()).length, 2) // pushed inside the tab
assert.equal(viewsById[childScreenIds(exploreStackId())[1]].props.title, 'componentes')
assert.equal(rootScreenIds().length, 1)

press(descendantOfType(childScreenIds(exploreStackId())[1], 'PressableView')) // <Link href="/items/1" push>
await settle()
assert.equal(rootScreenIds().length, 2) // over the tabs
globalThis.__dispatch(topRootScreenId(), 'dismissed')
await settle()

globalThis.__openURL('vuenative://explore') // navigate: back to the tab's first screen
await settle()
assert.equal(childScreenIds(exploreStackId()).length, 1)

// ---------- Gestures and Animated (native driver) ----------

globalThis.__openURL('vuenative://explore/gestures')
await settle()
const gesturesScreenId = childScreenIds(exploreStackId()).at(-1)
assert.equal(viewsById[gesturesScreenId].props.title, 'Gestos')

// The card's transform follows animated values natively; the gestures write into them.
const cardId = findViewId((view) => view.props.onPan === true, gesturesScreenId)
const cardBinding = animated.styles[cardId]
assert.deepEqual(
  cardBinding.transform.map((step) => step.name),
  ['translateX', 'translateY', 'scale', 'rotate'],
)
assert.equal(viewsById[cardId].style.transform, undefined) // not sent as a static style

const [translationXId, translationYId] = cardBinding.transform.map((step) => step.node)
assert.deepEqual(animated.events[cardId].pan, {
  translationX: translationXId,
  translationY: translationYId,
})

globalThis.__dispatch(cardId, 'pan', { state: 'ended', translationX: 40, translationY: -10 })
await settle()
assert.deepEqual(
  animated.started.slice(-2).map(({ nodeId, type, toValue }) => [nodeId, type, toValue]),
  [
    [translationXId, 'spring', 0],
    [translationYId, 'spring', 0],
  ],
)

globalThis.__openURL('vuenative://explore/animations')
await settle()
const animationsScreenId = childScreenIds(exploreStackId()).at(-1)
assert.equal(viewsById[animationsScreenId].props.title, 'Animações')

const loops = animated.started.filter((animation) => animation.iterations === -1)
assert.equal(loops.length, 2)

const spinnerId = renderedViewIds(animationsScreenId).find(
  (id) => animated.styles[id]?.transform?.[0]?.name === 'rotate',
)
const spinInterpolation = animated.nodes[animated.styles[spinnerId].transform[0].node]
assert.deepEqual(spinInterpolation.outputRange, [0, 2 * Math.PI]) // '360deg' in radians

const animatedScrollViewId = descendantOfType(animationsScreenId, 'ScrollView')
assert.deepEqual(Object.keys(animated.events[animatedScrollViewId].scroll), ['y'])
assert.equal(viewsById[animatedScrollViewId].props.onScroll, false) // no JS per scroll frame

globalThis.__openURL('vuenative://explore')
await settle()
assert.deepEqual(animated.stopped.slice(-2).sort(), loops.map((loop) => loop.nodeId).sort()) // leaving the page stops its loops

// ---------- Data: fetch, AsyncStorage, setInterval ----------

globalThis.__openURL('vuenative://explore/data')
await settle()
const dataScreenId = childScreenIds(exploreStackId()).at(-1)
assert.ok(renderedTexts(dataScreenId).includes('Visitas a esta página: 1 (AsyncStorage)'))
assert.equal(storage.get('dataPageVisits'), '1')

pressButton('Carregar posts (fetch)', 1, dataScreenId)
await settle()
await settle() // the response arrives on a later turn
assert.deepEqual(fetchRequests.at(-1), {
  url: 'https://jsonplaceholder.typicode.com/posts?_limit=5',
  method: 'GET',
  headers: {},
  body: null,
})
assert.ok(renderedTexts(dataScreenId).includes('Primeiro post'))
assert.ok(renderedTexts(dataScreenId).includes('Segundo post'))

const response = await fetch('https://example.com', {
  method: 'post',
  headers: { 'Content-Type': 'text/plain' },
  body: 'oi',
})
assert.equal(response.ok, true)
assert.equal(response.headers.get('content-type'), 'application/json') // case-insensitive
assert.deepEqual(fetchRequests.at(-1), {
  url: 'https://example.com',
  method: 'POST',
  headers: { 'content-type': 'text/plain' },
  body: 'oi',
})

globalThis.__openURL('vuenative://explore')
await settle()

// ---------- List editing ----------

selectTab(0)
// A <Swipeable> row: [left actions, right actions, row], revealed natively by a drag.
const swipeableRowId = (text) =>
  findViewId(
    (view) => view.type === 'SwipeableView' && renderedTexts(view.children[2]).includes(text),
  )
const swipeActionId = (text, side) =>
  descendantOfType(
    viewsById[swipeableRowId(text)].children[side === 'left' ? 0 : 1],
    'PressableView',
  )

press(swipeActionId('Item 2', 'left')) // Concluir
await settle()
assert.ok(renderedTexts().includes('✓ Item 2'))
assert.ok(renderedTexts(swipeActionId('✓ Item 2', 'left')).includes('Reabrir'))

const deleteActionId = swipeActionId('✓ Item 2', 'right')
assert.ok(renderedTexts(deleteActionId).includes('Apagar'))

const animationsBeforeRemoval = layoutAnimations.length
press(deleteActionId)
await settle()
assert.equal(layoutAnimations.length, animationsBeforeRemoval + 1) // rows slide up
assert.ok(!renderedTexts().includes('✓ Item 2'))
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

// ---------- Saved state ----------

assert.deepEqual(JSON.parse(storage.get('items')), []) // the list was emptied above
assert.equal(storage.get('hideDoneItems'), 'false')

console.log('ok')
