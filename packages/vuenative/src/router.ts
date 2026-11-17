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
  onUnmounted,
  provide,
  reactive,
  shallowReactive,
  watch,
  watchEffect,
  type Component,
  type ComputedRef,
  type InjectionKey,
  type PropType,
  type VNode,
} from '@vue/runtime-core'
import { processColor } from './colors'
import { Pressable } from './components'
import { createApp } from './renderer'

export type Params = Record<string, string | string[]>

export interface HeaderItem {
  title?: string
  systemImage?: string // SF Symbol name
  onPress?: () => void
}

export interface ScreenOptions {
  title?: string
  headerShown?: boolean
  headerLargeTitle?: boolean
  headerBackTitle?: string
  headerTintColor?: string
  headerRight?: HeaderItem[]
  headerLeft?: HeaderItem[]
  presentation?: 'card' | 'modal' | 'formSheet' | 'fullScreenModal'
  // <Tabs> only
  tabBarLabel?: string
  tabBarIcon?: string // SF Symbol name
  tabBarBadge?: string | number
  lazy?: boolean
}

type Segment = { type: 'static' | 'param' | 'catchAll'; name: string }
type NavigationMode = 'push' | 'navigate' | 'replace'

interface LayoutNode {
  type: 'layout'
  directory: string
  component: Component | null
  name: string
  parent: LayoutNode | null
}

interface PageNode {
  type: 'page'
  name: string
  segments: Segment[]
  component: Component
  layouts: LayoutNode[]
}

type RouteNode = LayoutNode | PageNode

interface Target {
  href: string
  params: Params
}

interface Route {
  chain: RouteNode[]
  target: Target
}

interface PendingRoute extends Route {
  mode: NavigationMode
}

interface Entry {
  key: number
  node: RouteNode
  href: string
  params: Params
  pageOptions: ScreenOptions
  navigator: Navigator | null
  pendingRoutes: PendingRoute[]
}

interface Navigator {
  open(chain: RouteNode[], target: Target, mode: NavigationMode): void
  back(): boolean
  canGoBack(): boolean
  dismissAll(): void
}

interface StackNavigator extends Navigator {
  entries: Entry[]
  remove(entry: Entry): void
}

interface TabsNavigator extends Navigator {
  tabs: Entry[]
  state: { activeIndex: number }
}

interface NavigatorOptions {
  optionsByRouteName: Record<string, ScreenOptions>
  declaredNames: string[]
}

const ENTRY_KEY: InjectionKey<Entry | null> = Symbol('page entry')
const LAYOUT_ENTRY_KEY: InjectionKey<Entry> = Symbol('layout entry')
const NAVIGATOR_KEY: InjectionKey<NavigatorOptions> = Symbol('navigator options')
const FOCUS_KEY: InjectionKey<ComputedRef<boolean>> = Symbol('focus')
const ALWAYS_FOCUSED = computed(() => true)

// ---------- Route tree ----------

const layoutsByDirectory = new Map<string, LayoutNode>()
const pages: PageNode[] = []
let notFoundPage: PageNode | null = null

function segmentFromFileName(name: string): Segment {
  const catchAll = name.match(/^\[\.\.\.(\w+)\]$/)
  if (catchAll) return { type: 'catchAll', name: catchAll[1] }

  const param = name.match(/^\[(\w+)\]$/)
  if (param) return { type: 'param', name: param[1] }

  return { type: 'static', name }
}

function isGroup(name: string): boolean {
  return /^\(.+\)$/.test(name)
}

function relativeName(path: string, directory: string): string {
  return directory ? path.slice(directory.length + 1) : path
}

// Static segments beat params, params beat catch-alls; ties go to the longer path.
function specificity(page: PageNode): number {
  const weights = { static: 3, param: 2, catchAll: 1 }

  return page.segments.reduce((score, segment) => score * 4 + weights[segment.type], 0)
}

// Layouts from the root down to the folder of `path` (a file path without extension).
function layoutsAbove(path: string): LayoutNode[] {
  const directories = ['']
  const parts = path.split('/').slice(0, -1)

  for (const [index] of parts.entries()) directories.push(parts.slice(0, index + 1).join('/'))

  return directories
    .filter((directory) => layoutsByDirectory.has(directory))
    .map((directory) => layoutsByDirectory.get(directory)!)
}

function registerLayout(directory: string, component: Component | null) {
  layoutsByDirectory.set(directory, {
    type: 'layout',
    directory,
    component,
    name: directory,
    parent: null,
  })
}

function registerPage(path: string, component: Component): PageNode {
  const layouts = layoutsAbove(path)
  const segments = path
    .split('/')
    .filter((part) => !isGroup(part))
    .filter((part, index, parts) => !(part === 'index' && index === parts.length - 1))
    .map(segmentFromFileName)

  return {
    type: 'page',
    name: relativeName(path, layouts.at(-1)!.directory),
    segments,
    component,
    layouts,
  }
}

// '/src/app/(tabs)/index.vue' -> '(tabs)/index'
function routePathOf(filePath: string): string {
  return filePath.replace(/^.*?\/app\//, '').replace(/\.vue$/, '')
}

function buildRouteTree(routeFiles: RouteFiles) {
  const modulesByPath = new Map(
    Object.entries(routeFiles).map(([filePath, module]) => [routePathOf(filePath), module]),
  )
  const paths = [...modulesByPath.keys()]
  const componentOf = (path: string) => modulesByPath.get(path)!.default

  registerLayout('', null) // replaced by app/_layout.vue when it exists

  for (const path of paths.filter((path) => path.endsWith('_layout'))) {
    registerLayout(path.replace(/\/?_layout$/, ''), componentOf(path))
  }

  for (const layout of layoutsByDirectory.values()) {
    if (layout.directory === '') continue

    const parent = layoutsAbove(`${layout.directory}/_layout`).at(-2)!
    layout.parent = parent
    layout.name = relativeName(layout.directory, parent.directory)
  }

  for (const path of paths.filter((path) => !path.endsWith('_layout'))) {
    if (path === '+not-found') notFoundPage = registerPage(path, componentOf(path))
    else pages.push(registerPage(path, componentOf(path)))
  }

  notFoundPage ??= registerPage('+not-found', () => h('Text', null, "This screen doesn't exist."))
  pages.sort((first, second) => specificity(second) - specificity(first))
}

function matchSegments(segments: Segment[], pathParts: string[]): Params | null {
  const params: Params = {}

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

function parseQuery(query = ''): Params {
  const params: Params = {}

  for (const pair of query.split('&').filter(Boolean)) {
    const [key, value = ''] = pair.split('=')
    params[decodeURIComponent(key)] = decodeURIComponent(value)
  }

  return params
}

// The chain of nodes from the root layout to the page, plus what the page receives.
function resolveHref(href: string): Route {
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

  const page = notFoundPage!

  return { chain: [...page.layouts, page], target: { href, params: {} } }
}

function hrefOf(page: PageNode): string {
  return `/${page.segments.map((segment) => segment.name).join('/')}`
}

// Routes a layout navigates between: its own pages and the layouts nested right below it.
function childNodesOf(layout: RouteNode): RouteNode[] {
  const childPages = pages.filter((page) => page.layouts.at(-1) === layout)
  const childLayouts = [...layoutsByDirectory.values()].filter((other) => other.parent === layout)
  const childNodes: RouteNode[] = [...childPages, ...childLayouts]

  return childNodes.sort((first, second) => first.name.localeCompare(second.name))
}

// Where a layout starts when opened without a destination: its index page.
function initialRouteOf(layout: LayoutNode): Route {
  const descendants = pages.filter((page) => page.layouts.includes(layout))
  const page = descendants.find((candidate) => candidate.name.endsWith('index')) ?? descendants[0]

  return {
    chain: [...page.layouts.slice(page.layouts.indexOf(layout) + 1), page],
    target: { href: hrefOf(page), params: {} },
  }
}

// ---------- Navigation state ----------

let nextEntryKey = 1
let rootEntry: Entry

// Shallow: the route's component must not become reactive; pageOptions is replaced as a whole.
// `pendingRoutes` are opened, in order, once a nested layout's component creates its navigator: where
// it starts, then anything opened before it mounted (a lazy tab).
function createEntry(node: RouteNode, pendingChain: RouteNode[], target: Target): Entry {
  return shallowReactive<Entry>({
    key: nextEntryKey++,
    node,
    href: target.href,
    params: target.params,
    pageOptions: {},
    navigator: null,
    pendingRoutes: [{ chain: pendingChain, target, mode: 'push' }],
  })
}

function openBelow(entry: Entry, chain: RouteNode[], target: Target, mode: NavigationMode) {
  if (entry.navigator) entry.navigator.open(chain, target, mode)
  else entry.pendingRoutes.push({ chain, target, mode })
}

function openPendingRoutes(layoutEntry: Entry, navigator: Navigator) {
  for (const { chain, target, mode } of layoutEntry.pendingRoutes)
    navigator.open(chain, target, mode)

  layoutEntry.pendingRoutes = []
}

function createStackNavigator(layoutEntry: Entry): StackNavigator {
  const entries = shallowReactive<Entry[]>([])

  const navigator: StackNavigator = {
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
      if (top && top.node === node && rest.length > 0) return openBelow(top, rest, target, mode)

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

  openPendingRoutes(layoutEntry, navigator)

  return navigator
}

function createTabsNavigator(layoutEntry: Entry): TabsNavigator {
  const tabs = childNodesOf(layoutEntry.node).map((node) => {
    if (node.type === 'page') return createEntry(node, [], { href: hrefOf(node), params: {} })

    const { chain, target } = initialRouteOf(node)

    return createEntry(node, chain, target)
  })
  const state = shallowReactive({ activeIndex: 0 })

  const navigator: TabsNavigator = {
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

  openPendingRoutes(layoutEntry, navigator)

  return navigator
}

function go(href: string, mode: NavigationMode) {
  const { chain, target } = resolveHref(href)

  openBelow(rootEntry, chain.slice(1), target, mode)
}

export const router = {
  push: (href: string) => go(href, 'push'),
  replace: (href: string) => go(href, 'replace'),
  // Goes back to the route if it's already in a stack, otherwise pushes it.
  navigate: (href: string) => go(href, 'navigate'),
  back: () => Boolean(rootEntry.navigator?.back()),
  canGoBack: () => Boolean(rootEntry.navigator?.canGoBack()),
  dismissAll: () => rootEntry.navigator?.dismissAll(),
}

export function useRouter() {
  return router
}

// Type the params you expect, like expo-router: useLocalSearchParams<{ id: string }>()
export function useLocalSearchParams<RouteParams extends Params = Params>(): RouteParams {
  return inject(ENTRY_KEY)!.params as RouteParams
}

export function usePathname(): string {
  return inject(ENTRY_KEY)!.href.split('?')[0]
}

// Whether this screen is the one on screen: on top of its stack (or the selected tab), inside a
// focused parent. A ref.
export function useIsFocused(): ComputedRef<boolean> {
  return inject(FOCUS_KEY, ALWAYS_FOCUSED)
}

// Runs `effect` whenever the screen gains focus; the function it returns runs when it loses focus
// (or unmounts). Like expo-router's useFocusEffect, e.g. to reload data when coming back to a screen.
export function useFocusEffect(effect: () => void | (() => void)) {
  const isFocused = useIsFocused()
  let cleanup: (() => void) | null = null

  function runCleanup() {
    cleanup?.()
    cleanup = null
  }

  watch(
    isFocused,
    (focused) => {
      if (!focused) return runCleanup()

      const result = effect()
      cleanup = typeof result === 'function' ? result : null
    },
    { immediate: true },
  )
  onUnmounted(runCleanup)
}

// Focus flows down the navigator tree: a screen is focused when its parent is and it's the active one.
function provideFocus(isActive: () => boolean) {
  const parentFocused = useIsFocused()
  const isFocused = computed(() => parentFocused.value && isActive())

  provide(FOCUS_KEY, isFocused)
}

// vuenative://items/42 -> /items/42
function hrefFromURL(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '/')
}

globalThis.__openURL = (url) => router.navigate(hrefFromURL(url))

// ---------- Components ----------

// Screen options, as in expo-router: title, headerShown, headerLargeTitle, headerBackTitle,
// headerTintColor, headerRight / headerLeft: [{ title?, systemImage?, onPress }], and presentation:
// 'card' (pushed, the default), 'modal', 'formSheet' or 'fullScreenModal'. A modal brings its own
// header, and screens pushed after it open inside it.
function nativeScreenProps(entry: Entry, options: ScreenOptions, onDismissed?: () => void) {
  const headerItems = (items: HeaderItem[] = []) =>
    items.map(({ title, systemImage }) => ({ title, systemImage }))

  function pressHeaderItem({ side, index }: { side: 'left' | 'right'; index: number }) {
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

function mergedOptions(
  entry: Entry,
  screenOptions: ScreenOptions | undefined,
  optionsByRouteName: Record<string, ScreenOptions>,
): ScreenOptions {
  return { ...screenOptions, ...optionsByRouteName[entry.node.name], ...entry.pageOptions }
}

const ENTRY_PROP = { type: Object as PropType<Entry>, required: true } as const

const PageContent = defineComponent({
  props: { entry: ENTRY_PROP },

  setup(props) {
    provide(ENTRY_KEY, props.entry)

    return () => h(props.entry.node.component!)
  },
})

const LayoutContent = defineComponent({
  props: { entry: ENTRY_PROP },

  setup(props) {
    provide(LAYOUT_ENTRY_KEY, props.entry)
    provide(ENTRY_KEY, null) // <Stack.Screen> inside a layout configures routes, not a page

    return (): VNode => h(props.entry.node.component ?? Stack)
  },
})

function screenContent(entry: Entry): VNode {
  return entry.node.type === 'page' ? h(PageContent, { entry }) : h(LayoutContent, { entry })
}

// <Stack.Screen> / <Tabs.Screen>: inside a page it sets that page's options; inside <Stack> or <Tabs>
// it configures the route `name` (and, for tabs, their order).
const NavigatorScreen = defineComponent({
  name: 'NavigatorScreen',
  props: { name: String, options: Object as PropType<ScreenOptions> },

  setup(props) {
    const entry = inject(ENTRY_KEY, null)
    const navigatorOptions = inject(NAVIGATOR_KEY)!
    const name = props.name ?? ''

    if (!entry && !navigatorOptions.declaredNames.includes(name)) {
      navigatorOptions.declaredNames.push(name)
    }

    watchEffect(() => {
      if (entry) entry.pageOptions = props.options ?? {}
      else navigatorOptions.optionsByRouteName[name] = props.options ?? {}
    })

    return () => null
  },
})

function provideNavigatorOptions(): NavigatorOptions {
  const navigatorOptions = {
    optionsByRouteName: reactive<Record<string, ScreenOptions>>({}),
    declaredNames: reactive<string[]>([]),
  }
  provide(NAVIGATOR_KEY, navigatorOptions)

  return navigatorOptions
}

// Reads the options in its own render, so option changes re-render this screen only, never the
// navigator (re-rendering it re-runs its slot, whose <Stack.Screen> would write the options again).
const OPTIONS_PROPS = {
  screenOptions: Object as PropType<ScreenOptions>,
  optionsByRouteName: { type: Object as PropType<Record<string, ScreenOptions>>, required: true },
} as const

const StackScreen = defineComponent({
  props: {
    entry: ENTRY_PROP,
    navigator: { type: Object as PropType<StackNavigator>, required: true },
    ...OPTIONS_PROPS,
  },

  setup(props) {
    provideFocus(() => props.navigator.entries.at(-1) === props.entry)

    return (): VNode => {
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

const StackNavigatorComponent = defineComponent({
  name: 'Stack',
  props: { screenOptions: Object as PropType<ScreenOptions> },

  setup(props, { slots }) {
    const layoutEntry = inject(LAYOUT_ENTRY_KEY)!
    const navigator = (layoutEntry.navigator ??=
      createStackNavigator(layoutEntry)) as StackNavigator
    const { optionsByRouteName } = provideNavigatorOptions()

    return (): VNode =>
      h('ScreenStack', { style: { flex: 1 } }, [
        slots.default?.(),
        ...navigator.entries.map((entry): VNode =>
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
// Tab options: title / tabBarLabel, tabBarIcon (SF Symbol name), tabBarBadge, plus the header ones, and
// lazy: mount the tab's content only when it's first opened (faster startup, a short build on first open).
function tabContent(tab: Entry, options: ScreenOptions) {
  if (tab.node.type !== 'page') return screenContent(tab)

  return h('ScreenStack', { style: { flex: 1 } }, [
    h('Screen', nativeScreenProps(tab, options), [screenContent(tab)]),
  ])
}

const TabScreen = defineComponent({
  props: {
    tab: ENTRY_PROP,
    navigator: { type: Object as PropType<TabsNavigator>, required: true },
    ...OPTIONS_PROPS,
  },

  setup(props) {
    const isActive = () => props.navigator.tabs[props.navigator.state.activeIndex] === props.tab
    let hasBeenActive = false // once mounted, a lazy tab stays mounted

    provideFocus(isActive)

    return () => {
      const { tab } = props
      const options = mergedOptions(tab, props.screenOptions, props.optionsByRouteName)
      const tabBarItem = {
        label: options.tabBarLabel ?? options.title ?? tab.node.name,
        systemImage: options.tabBarIcon,
        badge: options.tabBarBadge,
      }

      hasBeenActive ||= isActive()
      const content = !options.lazy || hasBeenActive ? tabContent(tab, options) : null

      return h('Screen', { headerShown: false, tabBarItem }, [content])
    }
  },
})

const TabsNavigatorComponent = defineComponent({
  name: 'Tabs',
  props: { screenOptions: Object as PropType<ScreenOptions> },

  setup(props, { slots }) {
    const layoutEntry = inject(LAYOUT_ENTRY_KEY)!
    const navigator = (layoutEntry.navigator ??= createTabsNavigator(layoutEntry)) as TabsNavigator
    const { optionsByRouteName, declaredNames } = provideNavigatorOptions()

    // Tabs declared with <Tabs.Screen> come first, in that order; the others follow by name.
    const orderedTabs = computed(() => {
      const position = (tab: Entry) => {
        const declaredPosition = declaredNames.indexOf(tab.node.name)

        return declaredPosition === -1
          ? declaredNames.length + navigator.tabs.indexOf(tab)
          : declaredPosition
      }

      return [...navigator.tabs].sort((first, second) => position(first) - position(second))
    })

    function selectTab({ index }: { index: number }) {
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
              navigator,
              screenOptions: props.screenOptions,
              optionsByRouteName,
            }),
          ),
        ],
      )
  },
})

export const Stack = Object.assign(StackNavigatorComponent, { Screen: NavigatorScreen })
export const Tabs = Object.assign(TabsNavigatorComponent, { Screen: NavigatorScreen })

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

    return () => h(Pressable as Component, { ...attrs, onPress: navigate }, slots)
  },
})

type RouteFiles = Record<string, { default: Component }>

// routeFiles: import.meta.glob('/src/app/**/*.vue', { eager: true }), see entry.ts
export function createRouterApp(routeFiles: RouteFiles) {
  buildRouteTree(routeFiles)

  const { chain, target } = resolveHref('/')
  rootEntry = createEntry(layoutsByDirectory.get('')!, chain.slice(1), target)

  return createApp(defineComponent(() => () => h(LayoutContent, { entry: rootEntry })))
}
