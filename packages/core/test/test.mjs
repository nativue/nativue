// Runs the demo app's bundle against a fake __native and checks the resulting view tree.
import { readFileSync } from 'node:fs'
import assert from 'node:assert'
import { createSymbolicator } from '../cli/symbolicate.mjs'
import { processColor } from '../src/colors.ts'
import { rowAt, rowOffsets } from '../src/list-window.ts'

const ROW_HEIGHT = 64
const WINDOW = { width: 390, height: 844 }
const viewsById = { 0: { type: 'root', children: [], props: {}, style: {} } }
let keyboardDismissCount = 0
const layoutAnimations = []
const animated = { nodes: {}, started: [], stopped: [], styles: {}, events: {} }
const storage = new Map()
const fetchRequests = []
const abortedFetchIds = []
const blobsById = new Map()
const POSTS = [
  { id: 1, title: 'Primeiro post' },
  { id: 2, title: 'Segundo post' },
]

function detachEverywhere(childId) {
  for (const view of Object.values(viewsById)) {
    view.children = view.children.filter((id) => id !== childId)
  }
}

const reportedErrors = []
// What @nativue/haptics' native side was called with (its functions come from a plugin).
const hapticsCalls = []
// The texts @nativue/clipboard copied.
const copiedTexts = []
// The statements @nativue/sqlite sent, as [sql, parameters]: it gets no rows back, and a COUNT gets zeros.
const sqliteQueries = []

function fakeSqliteQuery(callId, _database, sql, parameters) {
  sqliteQueries.push([sql, parameters])
  const isCount = sql.includes('COUNT(*)')
  const result = {
    columns: isCount ? ['total', 'done'] : [],
    rows: isCount ? [[0, 0]] : [],
    changes: 0,
    lastInsertId: 0,
  }

  setTimeout(() => globalThis.__asyncFunctionFinished(callId, result, null))
}

// An async plugin function that always settles with `value`.
function resolvesWith(value) {
  return (callId) => setTimeout(() => globalThis.__asyncFunctionFinished(callId, value, null))
}

globalThis.__native = {
  'plugin:haptics.impact': (style) => hapticsCalls.push(['impact', style]),
  'plugin:haptics.notification': (type) => hapticsCalls.push(['notification', type]),
  'plugin:haptics.selection': () => hapticsCalls.push(['selection']),
  'pluginAsync:clipboard.copy': (callId, text) => {
    copiedTexts.push(text)
    resolvesWith(false)(callId)
  },
  'pluginAsync:sqlite.query': fakeSqliteQuery,
  'pluginAsync:sqlite.batch': resolvesWith({ changes: 0, lastInsertId: 0 }),
  'pluginAsync:sqlite.iterate': resolvesWith({ cursorId: 1, columns: [], rows: [], done: true }),
  'pluginAsync:sqlite.next': resolvesWith({ rows: [], done: true }),
  'pluginAsync:sqlite.end': resolvesWith(null),
  'pluginAsync:sqlite.close': resolvesWith(null),
  'pluginAsync:notifications.getPermission': resolvesWith({
    status: 'undetermined',
    granted: false,
    canAskAgain: true,
  }),
  'pluginAsync:notifications.requestPermission': resolvesWith({
    status: 'granted',
    granted: true,
    canAskAgain: true,
  }),
  'pluginAsync:notifications.schedule': resolvesWith('id'),
  'pluginAsync:notifications.cancel': resolvesWith(null),
  'pluginAsync:notifications.cancelAll': resolvesWith(null),
  'pluginAsync:notifications.getScheduled': resolvesWith([]),
  'pluginAsync:notifications.getLastResponse': resolvesWith(null),
  'pluginAsync:notifications.setChannel': resolvesWith(null),
  'pluginAsync:notifications.openSettings': resolvesWith(null),
  'plugin:notifications.setForegroundPresentation': () => null,
  windowSize: () => WINDOW,
  platform: () => 'ios',
  colorScheme: () => 'light',

  reportError: (message, details) => reportedErrors.push({ message, details }),

  create: (id, type) => (viewsById[id] = { type, children: [], props: {}, style: {} }),

  insert: (parentId, childId, index) => {
    detachEverywhere(childId)
    viewsById[parentId].children.splice(index, 0, childId)
  },

  remove: (id, subtreeIds) => {
    assert.ok(subtreeIds.includes(id))
    detachEverywhere(id)
  },

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

  // Answers like the native networking would, on a later turn: the response, its data, the end.
  sendRequest: (requestId, { url, method, headers, body, responseType }) => {
    fetchRequests.push({ url, method, headers, body })
    const text = JSON.stringify(POSTS)
    const bytes = Buffer.from(text)
    const data =
      responseType === 'blob'
        ? { blobId: storeBlob(bytes), offset: 0, size: bytes.length, type: 'application/json' }
        : responseType === 'bytes'
          ? new Uint8Array(bytes)
          : text
    const report = (eventName, payload) => globalThis.__networkEvent(requestId, eventName, payload)

    setTimeout(() => {
      report('response', { status: 200, headers: { 'Content-Type': 'application/json' }, url })
      report('data', { data })
      report('complete', { error: null, timedOut: false })
    })
  },
  abortRequest: (requestId) => abortedFetchIds.push(requestId),

  blobCreate: (parts) => {
    const pieces = parts.map((part) => {
      if ('string' in part) return Buffer.from(part.string)
      if ('bytes' in part) return Buffer.from(part.bytes)

      return readBlob(part.blob)
    })
    const bytes = Buffer.concat(pieces)

    return { blobId: storeBlob(bytes), size: bytes.length }
  },
  blobRead: (blobId, offset, size, encoding) => {
    const bytes = readBlob({ blobId, offset, size })

    if (encoding === 'bytes') return new Uint8Array(bytes)

    return encoding === 'base64' ? bytes.toString('base64') : bytes.toString('utf8')
  },
  blobRelease: (blobId) => blobsById.delete(blobId),
}

function storeBlob(bytes) {
  const blobId = String(blobsById.size + 1)
  blobsById.set(blobId, bytes)

  return blobId
}

function readBlob({ blobId, offset, size }) {
  return blobsById.get(blobId).subarray(offset, offset + size)
}

// Hermes has no fetch: whatwg-fetch only installs itself where there's none.
delete globalThis.fetch

;(0, eval)(
  readFileSync(new URL('../../../examples/demo/ios/App/main.bundle.js', import.meta.url), 'utf8'),
)

// Page options and the <Tabs.Screen> order apply on the next tick (the runtime drains it before handing
// the batch to native).
await new Promise((resolve) => setTimeout(resolve))

// ---------- FlatList's windowing: rows of different heights ----------

const offsets = rowOffsets([10, 30, 20])
assert.deepEqual(offsets, [0, 10, 40, 60])
assert.equal(rowAt(offsets, 0), 0)
assert.equal(rowAt(offsets, 39), 1)
assert.equal(rowAt(offsets, 40), 2)
assert.equal(rowAt(offsets, -50), 0) // bounce past the top
assert.equal(rowAt(offsets, 500), 2) // and past the bottom
assert.equal(rowAt(rowOffsets([]), 0), 0)

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
  const viewId = renderedViewIds(rootId).find((id) => predicate(viewsById[id], id))
  assert.ok(viewId !== undefined, `no rendered view matches ${predicate}`)

  return viewId
}

// Excludes the root itself: a tab's own <Screen> is not the screen inside it.
function descendantOfType(rootId, type) {
  return findViewId((view) => view.type === type && view !== viewsById[rootId], rootId)
}

// Pressable keeps a quick tap's pressed style for 130ms.
async function waitForPressRelease() {
  await new Promise((resolve) => setTimeout(resolve, 150))
  await settle()
}

function press(viewId, eventName = 'press') {
  globalThis.__dispatch(viewId, eventName)
}

function buttonTitled(title, rootId = 0) {
  return findViewId((view) => view.type === 'Button' && view.props.title === title, rootId)
}

// The outermost Pressable (or Link) showing `text`.
function pressableContaining(text, rootId = 0) {
  return findViewId(
    (view, id) => view.type === 'PressableView' && renderedTexts(id).includes(text),
    rootId,
  )
}

const settle = () => new Promise((resolve) => setTimeout(resolve))

const childScreenIds = (containerId) =>
  viewsById[containerId].children.filter((id) => viewsById[id].type === 'Screen')

const rootStackId = viewsById[0].children[0]
const rootScreenIds = () => childScreenIds(rootStackId)
const topRootScreenId = () => rootScreenIds().at(-1)

const tabBarId = findViewId((view) => view.type === 'TabBar')
const tabBar = viewsById[tabBarId]
const [welcomeTabId, exploreTabId] = childScreenIds(tabBarId)
const exploreStackId = () => descendantOfType(exploreTabId, 'ScreenStack') // lazy tab
const exploreScreenIds = () => childScreenIds(exploreStackId())
const topExploreScreenId = () => exploreScreenIds().at(-1)
const titleOf = (screenId) => viewsById[screenId].props.title

async function open(url) {
  globalThis.__openURL(`nativue://${url}`)
  await settle()

  return topExploreScreenId()
}

// ---------- Router: layouts and tabs ----------

assert.equal(viewsById[rootStackId].type, 'ScreenStack')
assert.equal(rootScreenIds().length, 1)
assert.equal(viewsById[rootScreenIds()[0]].props.headerShown, false) // (tabs) brings its own headers

// Tab icons from @nativue/icons reach the native side as their drawing, which @nativue/svg draws.
const tabBarItems = childScreenIds(tabBarId).map((id) => viewsById[id].props.tabBarItem)
assert.deepEqual(
  tabBarItems.map(({ label, badge }) => ({ label, badge })),
  [
    { label: 'Welcome', badge: undefined },
    { label: 'Explore', badge: undefined },
  ],
)
for (const { drawnIcon } of tabBarItems) {
  assert.equal(drawnIcon.drawer, 'svg')
  assert.deepEqual(drawnIcon.viewBox, [0, 0, 24, 24])
  assert.ok(drawnIcon.elements.length > 0)
}
assert.equal(tabBar.props.selectedIndex, 0)
assert.equal(tabBar.props.activeTintColor, processColor('#0e9f84'))
assert.equal(tabBar.props.inactiveTintColor, processColor('#6e6e73'))

// A page tab gets a single-screen stack for its header, hidden here.
assert.equal(viewsById[descendantOfType(welcomeTabId, 'Screen')].props.headerShown, false)

// ---------- Welcome: a native pager driven by Animated ----------

const pagerId = findViewId((view) => view.type === 'ScrollView', welcomeTabId)
const pager = viewsById[pagerId]
assert.equal(pager.props.horizontal, '') // boolean attribute
assert.equal(pager.props.pagingEnabled, '')
assert.equal(pager.props.showsHorizontalScrollIndicator, false)
assert.deepEqual(Object.keys(animated.events[pagerId].scroll), ['x'])
assert.equal(pager.props.onScroll, false) // no JS per scroll frame

// Pages are as wide as the window (Dimensions); their content fades with the scroll.
const pageIds = pager.children
assert.equal(pageIds.length, 3)
assert.ok(pageIds.every((id) => viewsById[id].style.width === WINDOW.width))
const firstPageContentId = viewsById[pageIds[0]].children[0]
const firstPageFade = animated.nodes[animated.styles[firstPageContentId].opacity]
assert.deepEqual(firstPageFade.inputRange, [-WINDOW.width, 0, WINDOW.width])
assert.equal(animated.started.filter((animation) => animation.iterations === -1).length, 1) // logo float

// Text is trimmed, so it can wrap onto its own lines in templates.
assert.ok(
  renderedTexts(welcomeTabId).includes(
    'Write the Vue you already know. Ship real native apps for iOS and Android.',
  ),
)

// Shadows cross the bridge like colors.
assert.ok(
  renderedViewIds(welcomeTabId).some(
    (id) => viewsById[id].style.shadowColor === processColor('#000000'),
  ),
)

// Lazy tab: nothing mounted until opened; navigating there mounts it on its first screen.
assert.equal(viewsById[exploreTabId].children.length, 0)

press(pressableContaining('Start exploring', welcomeTabId))
await settle()
assert.equal(tabBar.props.selectedIndex, 1)
assert.deepEqual(exploreScreenIds().map(titleOf), ['Explore'])
assert.equal(viewsById[exploreScreenIds()[0]].props.headerShown, false) // its own header in the content

// ---------- Explore catalog ----------

const catalogId = exploreScreenIds()[0]
for (const title of [
  'Components',
  'Lists',
  'Animations',
  'Gestures',
  'Navigation',
  'Data',
  'Errors',
]) {
  assert.ok(renderedTexts(catalogId).includes(title), title)
}

press(pressableContaining('Components', catalogId)) // <Link> inside <DemoRow>
await settle()
assert.deepEqual(exploreScreenIds().map(titleOf), ['Explore', 'Components'])
assert.equal(rootScreenIds().length, 1) // pushed inside the tab

// ---------- Components ----------

const componentsId = topExploreScreenId()
const tapCount = (count) => renderedTexts(componentsId).includes(`Tapped ${count} times`)
assert.ok(tapCount(0))

// <ImageBackground>: a box whose first child is the image, filling it, under the content.
const coverId = findViewId(
  (view) => view.children.some((id) => viewsById[id].text === 'Text over a photo'),
  componentsId,
)
const coverImage = viewsById[viewsById[coverId].children[0]]
assert.equal(coverImage.type, 'Image')
assert.equal(coverImage.style.position, 'absolute')
assert.match(coverImage.props.source, /^https:/)

press(pressableContaining('Primary button', componentsId))
press(buttonTitled('System button', componentsId))
await settle()
assert.ok(tapCount(2))

// Pressable: pressed-style while held, and the slot gets { pressed }.
const customPressableId = pressableContaining('Custom Pressable', componentsId)
press(customPressableId, 'pressin')
await settle()
assert.equal(viewsById[customPressableId].style.backgroundColor, processColor('#0e9f841f'))
assert.ok(renderedTexts(customPressableId).includes('Pressing…'))

press(customPressableId, 'pressout')
press(customPressableId)
await settle()
assert.ok(renderedTexts(customPressableId).includes('Pressing…')) // a quick tap stays visible
await waitForPressRelease()
assert.equal(viewsById[customPressableId].style.backgroundColor, null) // removed: native resets it
assert.ok(tapCount(3))

// Accessibility: role, alt and aria-* reach native together. A Pressable is a button.
assert.deepEqual(viewsById[customPressableId].props.accessibility, { role: 'button' })
const sectionTitle = renderedViewIds(componentsId)
  .map((id) => viewsById[id])
  .find((view) => view.text === 'TEXT')
assert.deepEqual(sectionTitle.props.accessibility, { role: 'heading', label: 'Text' })

// v-model on TextInput and Switch.
const nameInputId = descendantOfType(componentsId, 'TextInput')
const inputBorderColor = () => viewsById[nameInputId].style.borderColor
assert.equal(inputBorderColor(), processColor('transparent'))
globalThis.__dispatch(nameInputId, 'focus') // focused-style while focused
await settle()
assert.equal(inputBorderColor(), processColor('#0e9f84'))
globalThis.__dispatch(nameInputId, 'blur')
await settle()
assert.equal(inputBorderColor(), processColor('transparent'))
assert.equal(viewsById[nameInputId].props.value, '')
globalThis.__dispatch(nameInputId, 'changetext', 'Ana ')
await settle()
assert.ok(renderedTexts(componentsId).includes('Hello, Ana 👋')) // v-model.trim
assert.equal(viewsById[nameInputId].props.value, '') // the field keeps what was typed

globalThis.__dispatch(descendantOfType(componentsId, 'Switch'), 'valuechange', false)
await settle()
assert.ok(renderedTexts(componentsId).includes('Off'))

press(buttonTitled('Dismiss keyboard', componentsId))
assert.equal(keyboardDismissCount, 1)

// An error in a handler reaches the native error screen, with the file and the step it happened in.
const dismissKeyboard = globalThis.__native.dismissKeyboard
globalThis.__native.dismissKeyboard = () => {
  throw new TypeError('keyboard is gone')
}
press(buttonTitled('Dismiss keyboard', componentsId))
globalThis.__native.dismissKeyboard = dismissKeyboard
assert.equal(reportedErrors.length, 1)
assert.equal(reportedErrors[0].message, 'TypeError: keyboard is gone')
assert.ok(
  reportedErrors[0].details.startsWith(
    'native event handler\n  in src/components/Section.vue\n  in src/components/Page.vue\n' +
      '  in src/app/(tabs)/explore/components.vue\n',
  ),
)

const [localImage, remoteImage] = renderedViewIds(componentsId)
  .map((id) => viewsById[id])
  .filter((view) => view.type === 'Image')
assert.match(localImage.props.source, /^data:image\/png;base64,/) // imported asset is inlined
assert.equal(localImage.props.resizeMode, 'contain') // kebab-case attribute arrives camelized
assert.equal(remoteImage.props.source, 'https://picsum.photos/id/1018/800/400') // { uri }
assert.deepEqual(remoteImage.props.accessibility, { label: 'A lake among mountains' }) // alt

const largeIndicator = renderedViewIds(componentsId)
  .map((id) => viewsById[id])
  .find((view) => view.type === 'ActivityIndicator' && view.props.size === 'large')
assert.equal(largeIndicator.props.color, processColor('#0e9f84'))

// Icons (@nativue/icons/lucide) render the native <Svg> with the icon's elements.
const icons = renderedViewIds(componentsId)
  .map((id) => viewsById[id])
  .filter((view) => view.type === 'Svg')
const heart = icons.find((icon) => icon.props.color === processColor('#ff3b30'))
assert.deepEqual(heart.props.viewBox, [0, 0, 24, 24])
assert.deepEqual(heart.props.elements[0][0], 'path')
assert.deepEqual([heart.style.width, heart.style.height], [28, 28])
assert.deepEqual(
  icons.filter((icon) => icon.style.width === 32).map((icon) => icon.props.strokeWidth),
  [1, 1.5, 2, 2.5, 3],
)

const sheetId = descendantOfType(componentsId, 'Modal')
press(pressableContaining('Present a sheet', componentsId))
await settle()
assert.equal(viewsById[sheetId].props.visible, true)

globalThis.__dispatch(sheetId, 'requestclose') // sheet swiped down
await settle()
assert.equal(viewsById[sheetId].props.visible, false)

// ---------- Lists: FlatList, Swipeable, LayoutAnimation ----------

await open('explore') // navigate: back to the tab's first screen
assert.deepEqual(exploreScreenIds().map(titleOf), ['Explore'])

// Reassigned when the list screen is opened again.
let listId, listViewId, listView, listInputId

async function openList() {
  listId = await open('explore/list')
  listViewId = descendantOfType(listId, 'ScrollView')
  listView = viewsById[listViewId]
  listInputId = descendantOfType(listId, 'TextInput')
}

await openList()
assert.deepEqual(exploreScreenIds().map(titleOf), ['Explore', 'Lists'])
const listTexts = () => renderedTexts(listId)

function scrollList(y, height = 600) {
  globalThis.__dispatch(listViewId, 'scroll', { x: 0, y, width: 358, height })
}

// The rows container is the ScrollView child carrying the windowing padding.
const listWindow = () =>
  viewsById[listView.children.find((id) => 'paddingTop' in viewsById[id].style)]

assert.ok(listTexts().includes('1,000 ITEMS · 0 DONE'))
assert.ok(listTexts().includes('Swipe a row either way · pull to refresh')) // #header slot
assert.ok(listTexts().includes('End of the list')) // #footer slot
assert.equal(listWindow().children.length, 11) // the first row, and the offscreen ones after it

scrollList(100 * ROW_HEIGHT)
await settle()
assert.equal(listWindow().children.length, 30)
assert.equal(listWindow().style.paddingTop, 90 * ROW_HEIGHT)
assert.equal(listWindow().style.paddingBottom, (1000 - 120) * ROW_HEIGHT)
assert.ok(listTexts().includes('Item 101'))
assert.ok(!listTexts().includes('Item 1'))

scrollList(0)
await settle()

// Bouncing past the top reports a negative offset; the window must stay put.
const rowsAtTop = listWindow().children.length
scrollList(-150)
await settle()
assert.equal(listWindow().children.length, rowsAtTop)

// A <Swipeable> row: [left actions, right actions, row], revealed natively by a drag.
const swipeableRowId = (text) =>
  findViewId(
    (view) => view.type === 'SwipeableView' && renderedTexts(view.children[2]).includes(text),
    listId,
  )
const swipeActionId = (text, side) =>
  descendantOfType(
    viewsById[swipeableRowId(text)].children[side === 'left' ? 0 : 1],
    'PressableView',
  )

press(swipeActionId('Item 2', 'left'))
await settle()
assert.ok(listTexts().includes('1,000 ITEMS · 1 DONE'))
assert.ok(renderedTexts(swipeActionId('Item 2', 'left')).includes('Undo'))

const animationsBeforeRemoval = layoutAnimations.length
press(swipeActionId('Item 2', 'right'))
await settle()
assert.equal(layoutAnimations.length, animationsBeforeRemoval + 1) // rows slide up
assert.ok(!listTexts().includes('Item 2'))
assert.ok(listTexts().includes('999 ITEMS · 0 DONE'))

// The header button hides done items.
press(swipeActionId('Item 3', 'left'))
globalThis.__dispatch(listId, 'headeritempress', { side: 'right', index: 0 })
await settle()
assert.ok(!listTexts().includes('Item 3'))
assert.deepEqual(viewsById[listId].props.headerRightItems[0].title, 'Show done')

globalThis.__dispatch(listId, 'headeritempress', { side: 'right', index: 0 })
await settle()
assert.ok(listTexts().includes('Item 3'))

// Typing updates v-model; adding puts the typed text on top and clears the input.
const firstRowText = () => {
  const swipeableId = descendantOfType(listWindow().children[0], 'SwipeableView')

  return renderedTexts(viewsById[swipeableId].children[2])[0]
}

globalThis.__dispatch(listInputId, 'changetext', 'Buy milk')
// The add button holds only a plus icon.
press(
  findViewId(
    (view, id) =>
      view.type === 'PressableView' &&
      renderedViewIds(id).some((childId) => viewsById[childId].type === 'Svg'),
    listId,
  ),
)
await settle()
assert.equal(viewsById[listInputId].props.value, '')
assert.equal(firstRowText(), 'Buy milk')

// Return key (submitEditing) adds too.
globalThis.__dispatch(listInputId, 'changetext', 'Pay bills')
globalThis.__dispatch(listInputId, 'submitediting', 'Pay bills')
await settle()
assert.equal(firstRowText(), 'Pay bills')
assert.ok(listTexts().includes('1,001 ITEMS · 1 DONE'))

// ---------- Item screen: params, LayoutAnimation, Link, native pop, back ----------

press(pressableContaining('Item 1', swipeableRowId('Item 1')))
await settle()
assert.deepEqual(exploreScreenIds().map(titleOf), ['Explore', 'Lists', 'Item 1'])
const itemId = topExploreScreenId()
assert.equal(viewsById[itemId].props.headerBackTitle, 'Lists')

globalThis.__dispatch(descendantOfType(itemId, 'Switch'), 'valuechange', true)
await settle()
assert.deepEqual(layoutAnimations.at(-1), { type: 'spring', duration: 700, springDamping: 0.4 })
const badge = viewsById[findViewId((view) => view.style.transform !== undefined, itemId)]
assert.deepEqual(badge.style.transform, [{ scale: 1.15 }, { rotate: '-4deg' }])
assert.ok(listTexts().includes('1,001 ITEMS · 2 DONE'))

press(pressableContaining('Next: Item 3 ›', itemId)) // <Link push>
await settle()
assert.equal(titleOf(topExploreScreenId()), 'Item 3')

globalThis.__dispatch(topExploreScreenId(), 'dismissed') // back button / edge swipe
await settle()
assert.equal(titleOf(topExploreScreenId()), 'Item 1')

press(buttonTitled('Delete item', itemId)) // router.back()
await settle()
assert.equal(titleOf(topExploreScreenId()), 'Lists')
assert.ok(listTexts().includes('1,000 ITEMS · 1 DONE'))

// ---------- Navigation: stack, modal route, focus, deep links, tabs ----------

const navigationId = await open('explore/navigation')
// The counter is the text right under the FOCUS section title.
const focusCount = () => {
  const texts = renderedTexts(navigationId)

  return texts[texts.indexOf('FOCUS') + 1]
}
assert.equal(titleOf(navigationId), 'Navigation')
assert.equal(focusCount(), '1')

press(pressableContaining('Push a screen', navigationId))
await settle()
assert.equal(titleOf(topExploreScreenId()), 'Screen 1')

press(pressableContaining('Push another', topExploreScreenId()))
await settle()
assert.equal(titleOf(topExploreScreenId()), 'Screen 2')

press(buttonTitled('Back', topExploreScreenId()))
await settle()
assert.equal(titleOf(topExploreScreenId()), 'Screen 1')

press(buttonTitled('Pop to Navigation', topExploreScreenId())) // navigate: back to it, not a new one
await settle()
assert.equal(topExploreScreenId(), navigationId)
assert.equal(focusCount(), '2') // useFocusEffect

// The modal route opens on the root stack, over the tabs.
press(pressableContaining('Open the modal route', navigationId))
await settle()
assert.equal(rootScreenIds().length, 2)
const modalProps = viewsById[topRootScreenId()].props
assert.equal(modalProps.stackPresentation, 'modal') // from the root layout
assert.equal(modalProps.title, 'Modal')
assert.equal(modalProps.headerTintColor, processColor('#0e9f84')) // root screenOptions
assert.equal(focusCount(), '2')

globalThis.__dispatch(topRootScreenId(), 'headeritempress', { side: 'right', index: 0 }) // Close
await settle()
assert.equal(rootScreenIds().length, 1)
assert.equal(focusCount(), '3')

press(pressableContaining('Open the modal route', navigationId))
await settle()
press(pressableContaining('Dismiss', topRootScreenId()))
await settle()
assert.equal(rootScreenIds().length, 1)

globalThis.__dispatch(navigationId, 'dismissed') // back button: native pops it and reports it
await settle()
assert.deepEqual(exploreScreenIds().map(titleOf), ['Explore', 'Lists'])

// ---------- Gestures and Animated (native driver) ----------

const gesturesId = await open('explore/gestures')
assert.equal(titleOf(gesturesId), 'Gestures')

// The card's transform follows animated values natively; the gestures write into them.
const cardId = findViewId((view) => view.props.onPan === true, gesturesId)
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

const animationCountBeforePage = animated.started.length
const animationsId = await open('explore/animations')
assert.equal(titleOf(animationsId), 'Animations')

const loops = animated.started
  .slice(animationCountBeforePage)
  .filter((animation) => animation.iterations === -1)
assert.equal(loops.length, 2)

const spinnerId = renderedViewIds(animationsId).find(
  (id) => animated.styles[id]?.transform?.[0]?.name === 'rotate',
)
const spinInterpolation = animated.nodes[animated.styles[spinnerId].transform[0].node]
assert.deepEqual(spinInterpolation.outputRange, [0, 2 * Math.PI]) // '360deg' in radians

// <Page :on-scroll> falls through to its ScrollView.
const animatedScrollViewId = descendantOfType(animationsId, 'ScrollView')
assert.deepEqual(Object.keys(animated.events[animatedScrollViewId].scroll), ['y'])

// The ball travels the track, which is sized from Dimensions.
const ballTravel = WINDOW.width - 2 * 24 - 2 * 16 - 44
press(pressableContaining('Timing', animationsId))
await settle()
assert.deepEqual(
  (({ type, toValue, duration }) => ({ type, toValue, duration }))(animated.started.at(-1)),
  { type: 'timing', toValue: ballTravel, duration: 600 },
)

press(pressableContaining('Spring', animationsId))
await settle()
assert.equal(animated.started.at(-1).type, 'spring')
assert.equal(animated.started.at(-1).toValue, 0)

press(pressableContaining('Linear', animationsId))
press(pressableContaining('Tap to expand', animationsId))
await settle()
assert.deepEqual(layoutAnimations.at(-1), { type: 'linear', duration: 500 })
assert.ok(renderedTexts(animationsId).includes('Expanded'))

await open('explore')
assert.deepEqual(animated.stopped.slice(-2).sort(), loops.map((loop) => loop.nodeId).sort()) // leaving the page stops its loops

// ---------- Data: fetch, AsyncStorage, setInterval ----------

const dataId = await open('explore/data')
assert.ok(renderedTexts(dataId).includes('Visits to this page'))
assert.equal(storage.get('dataPageVisits'), '1')

press(pressableContaining('Load posts', dataId))
// The response arrives on a later turn, and fetch reads its body (a Blob) on later ones.
for (let turn = 0; turn < 5; turn++) await settle()
assert.deepEqual(fetchRequests.at(-1), {
  url: 'https://jsonplaceholder.typicode.com/posts?_limit=5',
  method: 'GET',
  headers: {},
  body: null,
})
assert.ok(renderedTexts(dataId).includes('Primeiro post'))
assert.ok(renderedTexts(dataId).includes('Reload posts'))

const response = await fetch('https://example.com', {
  method: 'post',
  headers: { 'Content-Type': 'text/plain' },
  body: 'hi',
})
assert.equal(response.ok, true)
assert.equal(response.headers.get('content-type'), 'application/json') // case-insensitive
assert.deepEqual(fetchRequests.at(-1), {
  url: 'https://example.com',
  method: 'POST',
  headers: { 'content-type': 'text/plain' },
  body: { string: 'hi' },
})

// XMLHttpRequest, which fetch and libraries like axios build on.
function sendXhr(configure, body) {
  const xhr = new XMLHttpRequest()
  const events = []
  xhr.onreadystatechange = () => events.push(`readyState ${xhr.readyState}`)
  xhr.onload = () => events.push('load')
  xhr.open('POST', 'https://example.com/xhr')
  configure(xhr)

  return new Promise((resolve) => {
    xhr.addEventListener('loadend', () => resolve({ xhr, events: [...events, 'loadend'] }))
    xhr.send(body)
  })
}

const jsonRequest = await sendXhr((xhr) => (xhr.responseType = 'json'), 'hello')
assert.deepEqual(jsonRequest.xhr.response, POSTS)
assert.equal(jsonRequest.xhr.status, 200)
assert.equal(jsonRequest.xhr.getResponseHeader('Content-Type'), 'application/json')
assert.equal(jsonRequest.xhr.getAllResponseHeaders(), 'content-type: application/json\r\n')
assert.deepEqual(jsonRequest.events, [
  'readyState 1',
  'readyState 2',
  'readyState 3',
  'readyState 4',
  'load',
  'loadend',
])

// Binary both ways: bytes go to native and come back as bytes, a subarray as only what it sees.
const binaryRequest = await sendXhr(
  (xhr) => (xhr.responseType = 'arraybuffer'),
  new Uint8Array([0, 1, 2, 255]).subarray(1),
)
assert.deepEqual([...fetchRequests.at(-1).body.bytes], [1, 2, 255])
assert.equal(new TextDecoder().decode(binaryRequest.xhr.response), JSON.stringify(POSTS))

// Blob and FileReader: the bytes stay native, text is UTF-8.
const blob = new Blob(['olá ', new Uint8Array([0x63, 0x61, 0x66, 0xc3, 0xa9])], {
  type: 'Text/Plain',
})
assert.equal(blob.size, 10)
assert.equal(blob.type, 'text/plain')
assert.equal(await blob.text(), 'olá café')
assert.equal(await blob.slice(-5).text(), 'café')
assert.equal(await new Blob([blob.slice(0, 4), '!']).text(), 'olá!')
assert.deepEqual([...new Uint8Array(await blob.slice(0, 2).arrayBuffer())], [0x6f, 0x6c])

const dataUrl = await new Promise((resolve) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result)
  reader.readAsDataURL(new Blob(['hi'], { type: 'text/plain' }))
})
assert.equal(dataUrl, 'data:text/plain;base64,aGk=')

// Blob.stream(): 64 KB chunks, read from native as they're asked for.
const bigBlob = new Blob(['é'.repeat(50 * 1024)]) // 100 KB
const streamReader = bigBlob.stream().getReader()
const firstChunk = await streamReader.read()
assert.equal(firstChunk.value.length, 64 * 1024)
assert.equal((await streamReader.read()).value.length, 100 * 1024 - 64 * 1024)
assert.deepEqual(await streamReader.read(), { done: true, value: undefined })

let streamedLength = 0
for await (const chunk of new Blob(['abc']).stream()) streamedLength += chunk.length
assert.equal(streamedLength, 3)

// Breaking out of the loop cancels the stream; a source can enqueue ahead of reads, or fail.
const pushed = new ReadableStream({
  start(controller) {
    controller.enqueue('a')
    controller.enqueue('b')
    controller.close()
  },
})
const pushedChunks = []
for await (const chunk of pushed) pushedChunks.push(chunk)
assert.deepEqual(pushedChunks, ['a', 'b'])
assert.equal(pushed.locked, false)
const failing = new ReadableStream({
  pull: () => {
    throw new Error('boom')
  },
})
await assert.rejects(failing.getReader().read(), /boom/)

// URL and URLSearchParams (Hermes has neither).
const url = new URL('../b/./c?x=1&y=a+b#top', 'HTTPS://Example.com:443/a/z/index.html')
assert.equal(url.href, 'https://example.com/a/b/c?x=1&y=a+b#top')
assert.equal(url.origin, 'https://example.com')
assert.equal(url.searchParams.get('y'), 'a b')
url.searchParams.set('x', "it's 1")
url.searchParams.append('z', '&')
assert.equal(url.search, '?x=it%27s+1&y=a+b&z=%26')
url.search = '?q=1'
assert.deepEqual([...url.searchParams], [['q', '1']])
assert.equal(new URL('/api?v=2', 'http://localhost:8765/x').href, 'http://localhost:8765/api?v=2')
assert.equal(
  new URL('//cdn.example.com/a.png', 'https://example.com').href,
  'https://cdn.example.com/a.png',
)
assert.equal(new URLSearchParams({ a: '1', b: 'two words' }).toString(), 'a=1&b=two+words')
assert.throws(() => new URL('not a url'), TypeError)

// A URLSearchParams body is sent as a form, with its Content-Type, from fetch and XMLHttpRequest.
await fetch('https://example.com/login', {
  method: 'POST',
  body: new URLSearchParams({ user: 'ana', password: 'p&ss word' }),
})
assert.deepEqual(fetchRequests.at(-1).body, { string: 'user=ana&password=p%26ss+word' })
assert.equal(
  fetchRequests.at(-1).headers['content-type'],
  'application/x-www-form-urlencoded;charset=UTF-8',
)
await sendXhr(() => {}, new URLSearchParams('a=1'))
assert.deepEqual(fetchRequests.at(-1).headers, {
  'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
})
await sendXhr(
  (xhr) => xhr.setRequestHeader('Content-Type', 'text/plain'),
  new URLSearchParams('a=1'),
)
assert.equal(fetchRequests.at(-1).headers['content-type'], 'text/plain')

// An object URL shows a Blob in <Image>; it keeps the Blob alive until revoked.
const imageBlob = new Blob(['png bytes'], { type: 'image/png' })
const objectUrl = URL.createObjectURL(imageBlob.slice(4))
assert.equal(objectUrl, `blob:${imageBlob.data.blobId}?offset=4&size=5`)
URL.revokeObjectURL(objectUrl)

// fetch keeps the response a native Blob, read as UTF-8 text or as bytes.
const blobResponse = await fetch('https://example.com/posts')
assert.deepEqual(await blobResponse.clone().json(), POSTS)
assert.equal((await blobResponse.clone().blob()).type, 'application/json')
assert.equal(new TextDecoder().decode(await blobResponse.arrayBuffer()), JSON.stringify(POSTS))

// A Blob as the body, alone or as a FormData file.
const photo = new File(['jpeg bytes'], 'photo.jpg', { type: 'image/jpeg' })
await fetch('https://example.com/upload', { method: 'POST', body: photo })
assert.deepEqual(fetchRequests.at(-1).body, { blob: photo.data })
const photoForm = new FormData()
photoForm.append('photo', photo)
photoForm.append('note', new Blob(['n']), 'note.txt')
await fetch('https://example.com/upload', { method: 'POST', body: photoForm })
assert.deepEqual(fetchRequests.at(-1).body.formData, [
  { name: 'photo', blob: photo.data, filename: 'photo.jpg', type: 'image/jpeg' },
  {
    name: 'note',
    blob: photoForm.get('note').data,
    filename: 'note.txt',
    type: 'application/octet-stream',
  },
])

// FormData: text fields and files, which native reads by uri into a multipart body.
const form = new FormData()
form.append('title', 'Trip')
form.append('photo', { uri: 'file:///photo.jpg', name: 'photo.jpg', type: 'image/jpeg' })
form.append('count', 2)
await fetch('https://example.com/upload', { method: 'POST', body: form })
assert.deepEqual(fetchRequests.at(-1).body, {
  formData: [
    { name: 'title', value: 'Trip' },
    { name: 'photo', uri: 'file:///photo.jpg', filename: 'photo.jpg', type: 'image/jpeg' },
    { name: 'count', value: '2' },
  ],
})

// AbortController: the promise rejects with an AbortError at once, and native cancels the request.
const controller = new AbortController()
const abortedRequest = fetch('https://example.com/slow', { signal: controller.signal })
controller.abort()
await assert.rejects(abortedRequest, { name: 'AbortError' })
assert.equal(abortedFetchIds.length, 1)
await settle() // the fake's late answer finds no request: nothing happens
await assert.rejects(fetch('https://example.com', { signal: controller.signal }), {
  name: 'AbortError',
})
assert.equal(abortedFetchIds.length, 1) // aborted before it started: native never heard of it

press(buttonTitled('Reset', dataId))
await settle()
assert.equal(storage.has('dataPageVisits'), false)

press(buttonTitled('Pause', dataId))
await settle()
assert.ok(viewsById[buttonTitled('Resume', dataId)])

// ---------- Deep links and not found ----------

globalThis.__openURL('nativue://does/not/exist')
await settle()
assert.equal(titleOf(topRootScreenId()), 'Not found')
assert.ok(renderedTexts(topRootScreenId()).includes('Nothing at /does/not/exist'))

press(pressableContaining('Go to the start ›', topRootScreenId())) // <Link href="/">
await settle()
assert.equal(rootScreenIds().length, 1)
assert.equal(tabBar.props.selectedIndex, 0)

// ---------- Pull to refresh and the empty list ----------

await openList()
globalThis.__dispatch(listViewId, 'refresh')
await settle()
assert.equal(listView.props.refreshing, true)

await new Promise((resolve) => setTimeout(resolve, 900))
assert.equal(listView.props.refreshing, false)
assert.ok(listTexts().includes('1,000 ITEMS · 0 DONE'))

while (listWindow().children.length > 0) {
  const firstRowId = descendantOfType(listWindow().children[0], 'SwipeableView')
  press(descendantOfType(viewsById[firstRowId].children[1], 'PressableView')) // Delete
  await settle()
}
assert.ok(listTexts().includes('Nothing here. Pull to bring the items back.')) // #empty slot

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

// ---------- Tailwind (@nativue/tailwind) ----------

// class="flex-1 items-center rounded-full border-2 py-2", plus the selected plan's colors (brand comes
// from the demo's src/tailwind.css).
const tailwindId = await open('explore/tailwind')
const planStyle = (plan) => viewsById[pressableContaining(plan, tailwindId)].style
const brandGreen = processColor('#0e9f84')
assert.deepEqual(planStyle('Pro'), {
  flex: 1,
  alignItems: 'center',
  borderRadius: 9999,
  borderWidth: 2,
  paddingVertical: 8,
  borderColor: brandGreen,
  backgroundColor: brandGreen,
})

press(pressableContaining('Team', tailwindId))
await settle()
assert.equal(planStyle('Team').backgroundColor, brandGreen)
assert.equal(planStyle('Pro').backgroundColor, processColor('#ffffff'))
assert.notEqual(planStyle('Pro').borderColor, brandGreen)

// style wins over class.
const styledBoxId = findViewId(
  (view) =>
    view.children.some((childId) => viewsById[childId].text === 'class="bg-sky-500", style purple'),
  tailwindId,
)
assert.equal(viewsById[styledBoxId].style.backgroundColor, processColor('#af52de'))

// Variants: active: while pressed, dark: with the system's scheme, ios: on the fake native's platform.
const pressMeId = pressableContaining('Press me', tailwindId)
const inkColor = processColor('#0b1220')
globalThis.__dispatch(pressMeId, 'pressin')
await settle()
assert.equal(viewsById[pressMeId].style.backgroundColor, inkColor)
assert.deepEqual(viewsById[pressMeId].style.transform, [{ scale: 0.95 }])
globalThis.__dispatch(pressMeId, 'pressout')
await waitForPressRelease()
assert.equal(viewsById[pressMeId].style.backgroundColor, brandGreen)
assert.equal(viewsById[pressMeId].style.transform, null)

// focus: while the input has focus, disabled: on a disabled Pressable (which the native view gets too).
const focusInputId = findViewId((view) => view.type === 'TextInput', tailwindId)
assert.equal(viewsById[focusInputId].style.borderColor, processColor('#e2e8f0'))
globalThis.__dispatch(focusInputId, 'focus')
await settle()
assert.equal(viewsById[focusInputId].style.borderColor, brandGreen)
globalThis.__dispatch(focusInputId, 'blur')
await settle()
assert.equal(viewsById[focusInputId].style.borderColor, processColor('#e2e8f0'))
const disabledId = pressableContaining('Disabled', tailwindId)
assert.equal(viewsById[disabledId].props.disabled, true)
assert.equal(viewsById[disabledId].style.backgroundColor, processColor('#cad5e2'))

const darkCardId = findViewId(
  (view) =>
    view.children.some((childId) => viewsById[childId].text === 'This card follows dark mode'),
  tailwindId,
)
assert.equal(viewsById[darkCardId].style.backgroundColor, processColor('#ffffff'))
// The demo's own styles (themedStyles in lib/theme.ts) follow the scheme too: the page's background.
const pageId = findViewId(
  (view) => view.type === 'ScrollView' && view.children.length > 0,
  tailwindId,
)
assert.equal(viewsById[pageId].style.backgroundColor, processColor('#f1f5f9'))
globalThis.__colorSchemeChanged('dark')
await settle()
assert.equal(viewsById[darkCardId].style.backgroundColor, inkColor)
assert.equal(viewsById[pageId].style.backgroundColor, inkColor)
globalThis.__colorSchemeChanged('light')
await settle()
assert.equal(viewsById[darkCardId].style.backgroundColor, processColor('#ffffff'))
assert.equal(viewsById[pageId].style.backgroundColor, processColor('#f1f5f9'))

const platformCardId = findViewId(
  (view) => view.children.some((childId) => viewsById[childId].text === 'Blue on iOS'),
  tailwindId,
)
assert.ok(viewsById[platformCardId].style.backgroundColor) // ios:bg-sky-100, not android:'s

// ---------- SVG: <svg> as on the web, drawn by one native view ----------

const svgScreenId = await open('explore/svg')
const [chartId, effectsId, illustrationId, badgeId, moreId] = renderedViewIds(svgScreenId).filter(
  (id) => viewsById[id].type === 'Svg',
)
const drawingOf = (id) => viewsById[id].props.drawing
const elementsTagged = (element, tag) => [
  ...(element[0] === tag ? [element] : []),
  ...(Array.isArray(element[2]) ? element[2].flatMap((child) => elementsTagged(child, tag)) : []),
]
// <text>'s content is its runs: its text and its <tspan>s.
const chartTitle = () =>
  elementsTagged(drawingOf(chartId), 'text')
    .at(-1)[2]
    .map((run) => run[2])
    .join('')

// What's inside the <svg> never becomes a native view: the root gets it all as one drawing.
assert.equal(renderedViewIds(chartId).length, 1)
assert.deepEqual(drawingOf(chartId)[1].viewBox, [0, 0, 300, 170])
assert.equal(elementsTagged(drawingOf(chartId), 'stop')[0][1]['stop-opacity'], 0.45)
assert.equal(elementsTagged(drawingOf(chartId), 'stop')[0][1].offset, 0)
assert.deepEqual(viewsById[chartId].style.width, 320) // the width attribute sizes it
assert.equal(chartTitle(), 'Sun: 8,300 steps')

const circles = elementsTagged(drawingOf(chartId), 'circle')
assert.equal(circles.length, 7)
assert.ok(circles.every(([, attributes]) => typeof attributes.nodeId === 'number')) // they take presses
assert.equal(typeof circles[0][1].fill, 'number') // colors as 0xRRGGBBAA, like styles

globalThis.__dispatch(chartId, 'elementpress', { nodeIds: [circles[3][1].nodeId], x: 0, y: 0 })
await settle()
assert.equal(chartTitle(), 'Thu: 9,800 steps')
assert.equal(elementsTagged(drawingOf(chartId), 'circle')[3][1].r, 7)

// <Svg>, <Circle>, <G>: the same drawing, the transform as a matrix.
const group = elementsTagged(drawingOf(illustrationId), 'g')[0]
assert.equal(group[1].opacity, 0.85)
assert.deepEqual(
  group[1].transform.map((value) => Number(value.toFixed(3))),
  [0.966, 0.259, -0.259, 0.966, 80, 14],
)
assert.equal(elementsTagged(drawingOf(illustrationId), 'radialGradient')[0][1].id, 'sun')
// style="fill: ..." is a drawing attribute too.
assert.equal(elementsTagged(drawingOf(illustrationId), 'rect')[0][1].fill, 0x94a3b8ff)

// <use href="#star">: a copy of the symbol, moved and fitted, inheriting the <use>'s fill.
const effects = drawingOf(effectsId)
const stars = effects[2].filter(([tag, attributes]) => tag === 'g' && attributes.fill !== undefined)
assert.equal(stars.length, 3)
assert.deepEqual(stars[1][1].transform, [1, 0, 0, 1, 30, 84])
assert.equal(stars[1][2][0][0], 'g') // the symbol's viewBox, fitted into 22 by 22
assert.equal(elementsTagged(stars[1][2][0], 'path').length, 1)
// A gradient's href lends it the stops and attributes it doesn't set.
const across = elementsTagged(effects, 'linearGradient').find(
  ([, attributes]) => attributes.id === 'brandAcross',
)
assert.equal(elementsTagged(across, 'stop').length, 2)
assert.deepEqual([across[1].x2, across[1].y2], [1, 0])
// filter="url(#id)" with an feDropShadow: a shadow, [dx, dy, blur, color].
const card = elementsTagged(effects, 'rect').find(([, attributes]) => attributes.shadow)
assert.deepEqual(card[1].shadow.slice(0, 3), [0, 3, 3])
assert.equal(card[1].filter, undefined)
// <text> and its <tspan>: runs, whitespace collapsed to single spaces and trimmed at the ends.
const [doneText] = elementsTagged(effects, 'text')
assert.deepEqual(
  doneText[2].map(([, , text]) => text),
  ['75% done ', "of today's goal"], // the space between them is one, as in SVG
)
const ring = () =>
  elementsTagged(drawingOf(effectsId), 'circle').find(
    ([, attributes]) => attributes['stroke-dashoffset'] !== undefined,
  )
assert.equal(Math.round(ring()[1]['stroke-dashoffset']), 47)
press(pressableContaining('More progress', svgScreenId))
await settle()
assert.equal(ring()[1]['stroke-dashoffset'], 0)

// An imported .svg is a component: its <style>'s rules applied to the elements they select, the more
// specific one winning (#badge .ring over .cls-1 order), and the <style> itself left out.
const badgeDrawing = drawingOf(badgeId)
const [badgeRing, badgeDisc] = elementsTagged(badgeDrawing, 'circle')
assert.equal(badgeRing[1].fill, 0x4af2aeff)
assert.equal(badgeDisc[1].fill, 0x0e9f84ff)
assert.equal(elementsTagged(badgeDrawing, 'path')[0][1]['stroke-width'], 4)
assert.equal(elementsTagged(badgeDrawing, 'style').length, 0)
assert.equal(viewsById[badgeId].style.width, 48)

// Design tools' shadow (feOffset, feGaussianBlur, feColorMatrix): a shadow in the matrix's color.
const more = drawingOf(moreId)
const exportedCard = elementsTagged(more, 'rect').find(([, attributes]) => attributes.shadow)
assert.deepEqual(exportedCard[1].shadow, [0, 4, 4, 0x0b122040])
// feGaussianBlur alone: a blur. Filters themselves aren't sent.
assert.equal(elementsTagged(more, 'circle')[0][1].blur, 4)
assert.equal(elementsTagged(more, 'filter').length, 0)
// Markers become groups at the vertices: an arrow at each end of the path, turned with it.
const markedPath = elementsTagged(more, 'g').find(([, , children]) => children[0]?.[0] === 'path')
assert.equal(markedPath[2].length, 3)
// A marker's content inherits from the <marker>, not from the path's stroke.
assert.equal(markedPath[2][1][1].stroke, 'none')
assert.ok(elementsTagged(more, 'circle').length >= 3) // the polyline's middle vertices
// <pattern> goes to native with its transform as a matrix; <image> with its source.
const [stripes] = elementsTagged(more, 'pattern')
assert.equal(stripes[1].patternTransform.length, 6)
assert.equal(typeof elementsTagged(more, 'image')[0][1].href, 'string')
// <textPath>: its run carries the path it follows.
const curveRun = elementsTagged(more, 'text').at(-1)[2][0]
assert.equal(curveRun[0], 'textPath')
assert.equal(curveRun[1].d, 'M20 215 Q150 150 280 215')
assert.equal(curveRun[1].startOffset, '50%')
assert.equal(curveRun[2], 'Text along a curve')

// ---------- Native plugins (@nativue/haptics, @nativue/clipboard) ----------

const hapticsId = await open('explore/haptics')
globalThis.__dispatch(pressableContaining('heavy', hapticsId), 'press')
globalThis.__dispatch(pressableContaining('error', hapticsId), 'press')
globalThis.__dispatch(pressableContaining('selection', hapticsId), 'press')
assert.deepEqual(hapticsCalls, [['impact', 'heavy'], ['notification', 'error'], ['selection']])

const clipboardId = await open('explore/clipboard')
globalThis.__dispatch(pressableContaining('Copy', clipboardId), 'press')
await settle()
assert.deepEqual(copiedTexts, ['Hello from nativue'])
assert.ok(renderedTexts(clipboardId).includes('Copied'))

// @nativue/sqlite: its async plugin function, and named parameters numbered before they're sent.
const sqliteId = await open('explore/sqlite')
await settle()
assert.ok(renderedTexts(sqliteId).includes('Nothing yet: add one above.'))
assert.ok(sqliteQueries.some(([sql]) => sql.startsWith('CREATE TABLE IF NOT EXISTS todos')))

globalThis.__dispatch(descendantOfType(sqliteId, 'TextInput'), 'changetext', 'Buy milk')
press(pressableContaining('Add', sqliteId))
await settle()
assert.deepEqual(
  sqliteQueries.find(([sql]) => sql.startsWith('INSERT')),
  ['INSERT INTO todos (title) VALUES (?1)', ['Buy milk']],
)

// ---------- Errors ----------

const errorsId = await open('explore/errors')
press(pressableContaining('Throw in a press handler', errorsId))
assert.equal(reportedErrors.at(-1).message, 'Error: Something went wrong in a press handler')

press(pressableContaining('Break the render', errorsId))
await settle()
const renderError = reportedErrors.at(-1)
assert.match(renderError.message, /^TypeError/)
assert.ok(renderError.details.startsWith('render function\n'))
assert.ok(renderError.details.includes('  in src/app/(tabs)/explore/errors.vue\n'))

// ---------- Source maps ----------

// "AAAA;AACA;AACA": the bundle's lines 1 to 3 come from the same lines of the source. Frames outside
// the app's src/ collapse.
const symbolicate = createSymbolicator({
  'main.bundle.js': {
    sourceMap: {
      version: 3,
      sources: ['../../src/app/index.vue', '../../node_modules/vue/index.js'],
      names: [],
      mappings: 'AAAA;AACA;ACCA',
    },
    directory: 'ios/App',
  },
  'hmr_patch_1.js': {
    sourceMap: { version: 3, sources: ['../../src/app/detail.vue'], names: [], mappings: 'AAAA' },
    directory: 'ios/App',
  },
})
assert.equal(
  symbolicate('Error: boom\n    at setup (hmr_patch_1.js:1:1)'),
  'Error: boom\n    at setup (src/app/detail.vue:1:1)',
)
// Hermes' native frames count as framework frames.
assert.equal(
  symbolicate(
    'Error: boom\n    at throwInHandler (main.bundle.js:2:1)\n    at apply (native)\n    at call (main.bundle.js:3:1)',
  ),
  'Error: boom\n    at throwInHandler (src/app/index.vue:2:1)\n… 2 framework frame(s)',
)

console.log('ok')
