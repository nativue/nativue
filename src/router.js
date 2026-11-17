// File-based routing in the style of expo-router: every .vue file in src/app is a route.
//   app/index.vue           -> /
//   app/items/[id].vue      -> /items/:id     (useLocalSearchParams().id)
//   app/[...rest].vue       -> catch-all      (params.rest is an array)
//   app/(group)/x.vue       -> /x             (groups organize files without changing the url)
//   app/_layout.vue         -> root layout: <Stack /> (the default when missing)
//   app/(tabs)/_layout.vue  -> nested layout: <Tabs /> or <Stack />, for the routes in its folder
//   app/+not-found.vue      -> shown when no route matches
//
// Navigation state is a tree like React Navigation's: every layout on screen owns a navigator (a stack
// of entries, or a set of tabs), and an entry for a nested layout owns that layout's navigator.
import {
  computed,
  defineComponent,
  h,
  inject,
  provide,
  reactive,
  shallowReactive,
  watchEffect,
} from '@vue/runtime-core'
import { processColor } from './colors.js'
import { Pressable } from './components.js'
import { createApp } from './renderer.js'

const ENTRY_KEY = Symbol('page entry')
const LAYOUT_ENTRY_KEY = Symbol('layout entry')
const NAVIGATOR_KEY = Symbol('navigator options')

// ---------- Route tree ----------

const layoutsByDirectory = new Map()
const pages = []
let notFoundPage = null

function segmentFromFileName(name) {
  const catchAll = name.match(/^\[\.\.\.(\w+)\]$/)
  if (catchAll) return { type: 'catchAll', name: catchAll[1] }

  const param = name.match(/^\[(\w+)\]$/)
  if (param) return { type: 'param', name: param[1] }

  return { type: 'static', name }
}

function isGroup(name) {
  return /^\(.+\)$/.test(name)
}

function relativeName(path, directory) {
  return directory ? path.slice(directory.length + 1) : path
}

// Static segments beat params, params beat catch-alls; ties go to the longer path.
function specificity(page) {
  const weights = { static: 3, param: 2, catchAll: 1 }

  return page.segments.reduce((score, segment) => score * 4 + weights[segment.type], 0)
}

// Layouts from the root down to the folder of `path` (a file path without extension).
function layoutsAbove(path) {
  const directories = ['']
  const parts = path.split('/').slice(0, -1)

  for (const [index] of parts.entries()) directories.push(parts.slice(0, index + 1).join('/'))

  return directories
    .filter((directory) => layoutsByDirectory.has(directory))
    .map((directory) => layoutsByDirectory.get(directory))
}

function registerLayout(directory, component) {
  layoutsByDirectory.set(directory, {
    type: 'layout',
    directory,
    component,
    name: directory,
    parent: null,
  })
}

function registerPage(path, component) {
  const layouts = layoutsAbove(path)
  const segments = path
    .split('/')
    .filter((part) => !isGroup(part))
    .filter((part, index, parts) => !(part === 'index' && index === parts.length - 1))
    .map(segmentFromFileName)

  return {
    type: 'page',
    name: relativeName(path, layouts.at(-1).directory),
    segments,
    component,
    layouts,
  }
}

function buildRouteTree(routeFiles) {
  const paths = Object.keys(routeFiles).map((filePath) =>
    filePath.replace(/^\.\/app\//, '').replace(/\.vue$/, ''),
  )
  const componentOf = (path) => routeFiles[`./app/${path}.vue`].default

  registerLayout('', null) // replaced by app/_layout.vue when it exists

  for (const path of paths.filter((path) => path.endsWith('_layout'))) {
    registerLayout(path.replace(/\/?_layout$/, ''), componentOf(path))
  }

  for (const layout of layoutsByDirectory.values()) {
    if (layout.directory === '') continue

    layout.parent = layoutsAbove(`${layout.directory}/_layout`).at(-2)
    layout.name = relativeName(layout.directory, layout.parent.directory)
  }

  for (const path of paths.filter((path) => !path.endsWith('_layout'))) {
    if (path === '+not-found') notFoundPage = registerPage(path, componentOf(path))
    else pages.push(registerPage(path, componentOf(path)))
  }

  notFoundPage ??= registerPage('+not-found', () => h('Text', null, "This screen doesn't exist."))
  pages.sort((first, second) => specificity(second) - specificity(first))
}

function matchSegments(segments, pathParts) {
  const params = {}

  for (const [index, segment] of segments.entries()) {
    if (segment.type === 'catchAll') {
      params[segment.name] = pathParts.slice(index)

      return pathParts.length > index ? params : null
    }

    const part = pathParts[index]
    if (part === undefined) return null

    if (segment.type === 'param') params[segment.name] = decodeURIComponent(part)
    else if (segment.name !== part) return null
  }

  return segments.length === pathParts.length ? params : null
}

function parseQuery(query = '') {
  const params = {}

  for (const pair of query.split('&').filter(Boolean)) {
    const [key, value = ''] = pair.split('=')
    params[decodeURIComponent(key)] = decodeURIComponent(value)
  }

  return params
}

// The chain of nodes from the root layout to the page, plus what the page receives.
function resolveHref(href) {
  const [path, query] = href.split('?')
  const pathParts = path.split('/').filter(Boolean)

  for (const page of pages) {
    const pathParams = matchSegments(page.segments, pathParts)
    if (pathParams) {
      return {
        chain: [...page.layouts, page],
        target: { href, params: { ...parseQuery(query), ...pathParams } },
      }
    }
  }

  return { chain: [...notFoundPage.layouts, notFoundPage], target: { href, params: {} } }
}

function hrefOf(page) {
  return `/${page.segments.map((segment) => segment.name).join('/')}`
}

// Routes a layout navigates between: its own pages and the layouts nested right below it.
function childNodesOf(layout) {
  const childPages = pages.filter((page) => page.layouts.at(-1) === layout)
  const childLayouts = [...layoutsByDirectory.values()].filter((other) => other.parent === layout)

  return [...childPages, ...childLayouts].sort((first, second) =>
    first.name.localeCompare(second.name),
  )
}

// Where a layout starts when opened without a destination: its index page.
function initialRouteOf(layout) {
  const descendants = pages.filter((page) => page.layouts.includes(layout))
  const page = descendants.find((candidate) => candidate.name.endsWith('index')) ?? descendants[0]

  return {
    chain: [...page.layouts.slice(page.layouts.indexOf(layout) + 1), page],
    target: { href: hrefOf(page), params: {} },
  }
}

// ---------- Navigation state ----------

let nextEntryKey = 1
let rootEntry = null

// Shallow: the route's component must not become reactive; pageOptions is replaced as a whole.
// `pendingRoute` is where a nested layout's navigator starts once its component creates it.
function createEntry(node, pendingChain, target) {
  return shallowReactive({
    key: nextEntryKey++,
    node,
    href: target.href,
    params: target.params,
    pageOptions: {},
    navigator: null,
    pendingRoute: { chain: pendingChain, target },
  })
}

function openBelow(entry, chain, target, mode) {
  if (entry.navigator) entry.navigator.open(chain, target, mode)
  else entry.pendingRoute = { chain, target }
}

function createStackNavigator(layoutEntry) {
  const entries = shallowReactive([])

  const navigator = {
    entries,

    // `chain` starts with the child of this stack's layout; `mode` is push, navigate or replace.
    open(chain, target, mode) {
      const [node, ...rest] = chain

      if (mode === 'navigate') {
        const index = entries.findLastIndex(
          (entry) => entry.node === node && (rest.length > 0 || entry.href === target.href),
        )

        if (index !== -1) {
          entries.splice(index + 1)
          if (rest.length > 0) openBelow(entries[index], rest, target, mode)

          return
        }
      }

      const top = entries.at(-1)
      if (top?.node === node && rest.length > 0) return openBelow(top, rest, target, mode)

      const entry = createEntry(node, rest, target)
      if (mode === 'replace' && entries.length > 0) entries.splice(entries.length - 1, 1, entry)
      else entries.push(entry)
    },

    // The deepest stack goes back first, like the back button of nested navigators.
    back() {
      if (entries.at(-1)?.navigator?.back()) return true
      if (entries.length <= 1) return false

      entries.pop()

      return true
    },

    canGoBack() {
      return Boolean(entries.at(-1)?.navigator?.canGoBack()) || entries.length > 1
    },

    remove(entry) {
      const index = entries.indexOf(entry)
      if (index !== -1) entries.splice(index, 1)
    },

    dismissAll() {
      entries.splice(1)
    },
  }

  navigator.open(layoutEntry.pendingRoute.chain, layoutEntry.pendingRoute.target, 'push')

  return navigator
}

// ponytail: every tab is mounted up front (expo-router mounts lazily); add `lazy` if startup suffers.
function createTabsNavigator(layoutEntry) {
  const tabs = childNodesOf(layoutEntry.node).map((node) => {
    if (node.type === 'page') return createEntry(node, [], { href: hrefOf(node), params: {} })

    const { chain, target } = initialRouteOf(node)

    return createEntry(node, chain, target)
  })
  const state = shallowReactive({ activeIndex: 0 })

  const navigator = {
    tabs,
    state,

    open(chain, target, mode) {
      const [node, ...rest] = chain
      const index = tabs.findIndex((tab) => tab.node === node)
      if (index === -1) return

      state.activeIndex = index

      if (rest.length > 0) openBelow(tabs[index], rest, target, mode)
      else Object.assign(tabs[index], { href: target.href, params: target.params })
    },

    back() {
      return tabs[state.activeIndex].navigator?.back() ?? false
    },

    canGoBack() {
      return tabs[state.activeIndex].navigator?.canGoBack() ?? false
    },

    dismissAll() {
      tabs[state.activeIndex].navigator?.dismissAll()
    },
  }

  navigator.open(layoutEntry.pendingRoute.chain, layoutEntry.pendingRoute.target, 'push')

  return navigator
}

function go(href, mode) {
  const { chain, target } = resolveHref(href)

  openBelow(rootEntry, chain.slice(1), target, mode)
}

export const router = {
  push: (href) => go(href, 'push'),
  replace: (href) => go(href, 'replace'),
  // Goes back to the route if it's already in a stack, otherwise pushes it.
  navigate: (href) => go(href, 'navigate'),
  back: () => rootEntry.navigator?.back(),
  canGoBack: () => Boolean(rootEntry.navigator?.canGoBack()),
  dismissAll: () => rootEntry.navigator?.dismissAll(),
}

export function useRouter() {
  return router
}

export function useLocalSearchParams() {
  return inject(ENTRY_KEY).params
}

export function usePathname() {
  return inject(ENTRY_KEY).href.split('?')[0]
}

// vuenative://items/42 -> /items/42
function hrefFromURL(url) {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '/')
}

globalThis.__openURL = (url) => router.navigate(hrefFromURL(url))

// ---------- Components ----------

// Screen options, as in expo-router: title, headerShown, headerLargeTitle, headerBackTitle,
// headerTintColor, headerRight / headerLeft: [{ title?, systemImage?, onPress }], and presentation:
// 'card' (pushed, the default), 'modal', 'formSheet' or 'fullScreenModal'. A modal brings its own
// header, and screens pushed after it open inside it.
function nativeScreenProps(entry, options, onDismissed) {
  const headerItems = (items = []) =>
    items.map(({ title, systemImage }) => ({ title, systemImage }))

  function pressHeaderItem({ side, index }) {
    const items = side === 'right' ? options.headerRight : options.headerLeft
    items?.[index]?.onPress?.()
  }

  return {
    // A nested layout's name ('(tabs)') would show in the root bar while it fades out on a swipe back.
    title: options.title ?? (entry.node.type === 'page' ? entry.node.name : ''),
    // A nested layout brings its own headers.
    headerShown: options.headerShown ?? entry.node.type === 'page',
    headerLargeTitle: options.headerLargeTitle ?? false,
    stackPresentation:
      !options.presentation || options.presentation === 'card' ? 'push' : options.presentation,
    headerBackTitle: options.headerBackTitle,
    headerTintColor: options.headerTintColor && processColor(options.headerTintColor),
    headerRightItems: headerItems(options.headerRight),
    headerLeftItems: headerItems(options.headerLeft),
    onDismissed,
    onHeaderItemPress: pressHeaderItem,
  }
}

function mergedOptions(entry, screenOptions, optionsByRouteName) {
  return { ...screenOptions, ...optionsByRouteName[entry.node.name], ...entry.pageOptions }
}

const PageContent = defineComponent({
  props: { entry: Object },

  setup(props) {
    provide(ENTRY_KEY, props.entry)

    return () => h(props.entry.node.component)
  },
})

const LayoutContent = defineComponent({
  props: { entry: Object },

  setup(props) {
    provide(LAYOUT_ENTRY_KEY, props.entry)
    provide(ENTRY_KEY, null) // <Stack.Screen> inside a layout configures routes, not a page

    return () => h(props.entry.node.component ?? Stack)
  },
})

function screenContent(entry) {
  return entry.node.type === 'page' ? h(PageContent, { entry }) : h(LayoutContent, { entry })
}

// <Stack.Screen> / <Tabs.Screen>: inside a page it sets that page's options; inside <Stack> or <Tabs>
// it configures the route `name` (and, for tabs, their order).
const NavigatorScreen = defineComponent({
  name: 'NavigatorScreen',
  props: { name: String, options: Object },

  setup(props) {
    const entry = inject(ENTRY_KEY, null)
    const navigatorOptions = inject(NAVIGATOR_KEY)

    if (!entry && !navigatorOptions.declaredNames.includes(props.name)) {
      navigatorOptions.declaredNames.push(props.name)
    }

    watchEffect(() => {
      if (entry) entry.pageOptions = props.options ?? {}
      else navigatorOptions.optionsByRouteName[props.name] = props.options ?? {}
    })

    return () => null
  },
})

function provideNavigatorOptions() {
  const navigatorOptions = { optionsByRouteName: reactive({}), declaredNames: reactive([]) }
  provide(NAVIGATOR_KEY, navigatorOptions)

  return navigatorOptions
}

// Reads the options in its own render, so option changes re-render this screen only, never the
// navigator (re-rendering it re-runs its slot, whose <Stack.Screen> would write the options again).
const StackScreen = defineComponent({
  props: { entry: Object, navigator: Object, screenOptions: Object, optionsByRouteName: Object },

  setup(props) {
    return () => {
      const { entry, navigator } = props
      const options = mergedOptions(entry, props.screenOptions, props.optionsByRouteName)

      return h(
        'Screen',
        nativeScreenProps(entry, options, () => navigator.remove(entry)),
        [screenContent(entry)],
      )
    }
  },
})

export const Stack = defineComponent({
  name: 'Stack',
  props: { screenOptions: Object },

  setup(props, { slots }) {
    const layoutEntry = inject(LAYOUT_ENTRY_KEY)
    const navigator = (layoutEntry.navigator ??= createStackNavigator(layoutEntry))
    const { optionsByRouteName } = provideNavigatorOptions()

    return () =>
      h('ScreenStack', { style: { flex: 1 } }, [
        slots.default?.(),
        ...navigator.entries.map((entry) =>
          h(StackScreen, {
            key: entry.key,
            entry,
            navigator,
            screenOptions: props.screenOptions,
            optionsByRouteName,
          }),
        ),
      ])
  },
})

// A page tab gets a single-screen stack, for its header; a layout tab brings its own navigator.
// Tab options: title / tabBarLabel, tabBarIcon (SF Symbol name), tabBarBadge, plus the header ones.
const TabScreen = defineComponent({
  props: { tab: Object, screenOptions: Object, optionsByRouteName: Object },

  setup(props) {
    return () => {
      const { tab } = props
      const options = mergedOptions(tab, props.screenOptions, props.optionsByRouteName)
      const tabBarItem = {
        label: options.tabBarLabel ?? options.title ?? tab.node.name,
        systemImage: options.tabBarIcon,
        badge: options.tabBarBadge,
      }

      const content =
        tab.node.type === 'page'
          ? h('ScreenStack', { style: { flex: 1 } }, [
              h('Screen', nativeScreenProps(tab, options), [screenContent(tab)]),
            ])
          : screenContent(tab)

      return h('Screen', { headerShown: false, tabBarItem }, [content])
    }
  },
})

export const Tabs = defineComponent({
  name: 'Tabs',
  props: { screenOptions: Object },

  setup(props, { slots }) {
    const layoutEntry = inject(LAYOUT_ENTRY_KEY)
    const navigator = (layoutEntry.navigator ??= createTabsNavigator(layoutEntry))
    const { optionsByRouteName, declaredNames } = provideNavigatorOptions()

    // Tabs declared with <Tabs.Screen> come first, in that order; the others follow by name.
    const orderedTabs = computed(() => {
      const position = (tab) => {
        const declaredPosition = declaredNames.indexOf(tab.node.name)

        return declaredPosition === -1
          ? declaredNames.length + navigator.tabs.indexOf(tab)
          : declaredPosition
      }

      return [...navigator.tabs].sort((first, second) => position(first) - position(second))
    })

    function selectTab({ index }) {
      navigator.state.activeIndex = navigator.tabs.indexOf(orderedTabs.value[index])
    }

    return () =>
      h(
        'TabBar',
        {
          style: { flex: 1 },
          selectedIndex: orderedTabs.value.indexOf(navigator.tabs[navigator.state.activeIndex]),
          onTabChange: selectTab,
        },
        [
          slots.default?.(),
          ...orderedTabs.value.map((tab) =>
            h(TabScreen, {
              key: tab.key,
              tab,
              screenOptions: props.screenOptions,
              optionsByRouteName,
            }),
          ),
        ],
      )
  },
})

Stack.Screen = NavigatorScreen
Tabs.Screen = NavigatorScreen

// Like expo-router: navigates by default (back to the route if it's in a stack); `push` always adds
// a screen, `replace` swaps the current one.
export const Link = defineComponent({
  name: 'Link',
  props: { href: { type: String, required: true }, push: Boolean, replace: Boolean },

  setup(props, { attrs, slots }) {
    function navigate() {
      if (props.replace) router.replace(props.href)
      else if (props.push) router.push(props.href)
      else router.navigate(props.href)
    }

    return () => h(Pressable, { ...attrs, onPress: navigate }, slots)
  },
})

// routeFiles: import.meta.glob('./app/**/*.vue', { eager: true })
export function createRouterApp(routeFiles) {
  buildRouteTree(routeFiles)

  const { chain, target } = resolveHref('/')
  rootEntry = createEntry(layoutsByDirectory.get(''), chain.slice(1), target)

  return createApp(defineComponent(() => () => h(LayoutContent, { entry: rootEntry })))
}
