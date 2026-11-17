// File-based routing in the style of expo-router: every .vue file in src/app is a route.
//   app/index.vue        -> /
//   app/items/[id].vue   -> /items/:id     (useLocalSearchParams().id)
//   app/[...rest].vue    -> catch-all      (params.rest is an array)
//   app/(group)/x.vue    -> /x             (groups organize files without changing the url)
//   app/_layout.vue      -> root layout, renders <Stack /> (the default when missing)
//   app/+not-found.vue   -> shown when no route matches
// ponytail: one root layout with one stack; nested layouts (tabs) come next.
import {
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

const ENTRY_KEY = Symbol('route entry')
const STACK_KEY = Symbol('stack')

const routes = []
let notFoundComponent = defineComponent(() => () => h('Text', null, "This screen doesn't exist."))
let rootLayoutComponent = null

// ---------- Route table ----------

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

// Static segments beat params, params beat catch-alls; ties go to the longer path.
function specificity(route) {
  const weights = { static: 3, param: 2, catchAll: 1 }

  return route.segments.reduce((score, segment) => score * 4 + weights[segment.type], 0)
}

function registerRouteFile(filePath, component) {
  const name = filePath.replace(/^\.\/app\//, '').replace(/\.vue$/, '')

  if (name === '_layout') return (rootLayoutComponent = component)
  if (name === '+not-found') return (notFoundComponent = component)

  const segments = name
    .split('/')
    .filter((part) => !isGroup(part))
    .filter((part, index, parts) => !(part === 'index' && index === parts.length - 1))
    .map(segmentFromFileName)

  routes.push({ name, segments, component })
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

function resolveHref(href) {
  const [path, query] = href.split('?')
  const pathParts = path.split('/').filter(Boolean)

  for (const route of routes) {
    const pathParams = matchSegments(route.segments, pathParts)
    if (pathParams) return { route, params: { ...parseQuery(query), ...pathParams } }
  }

  return { route: { name: '+not-found', component: notFoundComponent }, params: {} }
}

// ---------- Navigation state ----------

const stack = shallowReactive([])
let nextEntryKey = 1

// Shallow: the route's component must not become reactive; pageOptions is replaced as a whole.
function createEntry(href) {
  return shallowReactive({ key: nextEntryKey++, href, ...resolveHref(href), pageOptions: {} })
}

function removeEntry(entry) {
  const index = stack.indexOf(entry)
  if (index !== -1) stack.splice(index, 1)
}

export const router = {
  push(href) {
    stack.push(createEntry(href))
  },

  replace(href) {
    stack.splice(stack.length - 1, 1, createEntry(href))
  },

  back() {
    if (router.canGoBack()) stack.pop()
  },

  canGoBack() {
    return stack.length > 1
  },

  // Goes back to the route if it's already in the stack, otherwise pushes it.
  navigate(href) {
    const index = stack.findIndex((entry) => entry.href === href)

    if (index === -1) router.push(href)
    else stack.splice(index + 1)
  },

  dismissAll() {
    stack.splice(1)
  },
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
// headerTintColor, headerRight / headerLeft: [{ title?, systemImage?, onPress }].
function nativeScreenProps(entry, options) {
  const headerItems = (items = []) =>
    items.map(({ title, systemImage }) => ({ title, systemImage }))

  function pressHeaderItem({ side, index }) {
    const items = side === 'right' ? options.headerRight : options.headerLeft
    items?.[index]?.onPress?.()
  }

  return {
    title: options.title ?? entry.route.name,
    headerShown: options.headerShown ?? true,
    headerLargeTitle: options.headerLargeTitle ?? false,
    headerBackTitle: options.headerBackTitle,
    headerTintColor: options.headerTintColor && processColor(options.headerTintColor),
    headerRightItems: headerItems(options.headerRight),
    headerLeftItems: headerItems(options.headerLeft),
    onDismissed: () => removeEntry(entry),
    onHeaderItemPress: pressHeaderItem,
  }
}

const ScreenContent = defineComponent({
  props: { entry: Object },

  setup(props) {
    provide(ENTRY_KEY, props.entry)

    return () => h(props.entry.route.component)
  },
})

const StackScreen = defineComponent({
  name: 'StackScreen',
  props: { name: String, options: Object },

  // Inside a page, it sets that page's options; inside <Stack>, the options of the route `name`.
  setup(props) {
    const entry = inject(ENTRY_KEY, null)
    const stackContext = inject(STACK_KEY)

    watchEffect(() => {
      if (entry) entry.pageOptions = props.options ?? {}
      else stackContext.optionsByRouteName[props.name] = props.options ?? {}
    })

    return () => null
  },
})

// Reads the options in its own render, so option changes re-render this screen only, never <Stack>
// (re-rendering <Stack> re-runs its slot, whose <Stack.Screen> would write the options again: a loop).
const NativeScreen = defineComponent({
  props: { entry: Object, screenOptions: Object, optionsByRouteName: Object },

  setup(props) {
    return () => {
      const { entry } = props
      const options = {
        ...props.screenOptions,
        ...props.optionsByRouteName[entry.route.name],
        ...entry.pageOptions,
      }

      return h('Screen', nativeScreenProps(entry, options), [h(ScreenContent, { entry })])
    }
  },
})

export const Stack = defineComponent({
  name: 'Stack',
  props: { screenOptions: Object },

  setup(props, { slots }) {
    const optionsByRouteName = reactive({})
    provide(STACK_KEY, { optionsByRouteName })

    return () =>
      h('ScreenStack', { style: { flex: 1 } }, [
        slots.default?.(),
        ...stack.map((entry) =>
          h(NativeScreen, {
            key: entry.key,
            entry,
            screenOptions: props.screenOptions,
            optionsByRouteName,
          }),
        ),
      ])
  },
})

Stack.Screen = StackScreen

// Like expo-router: navigates by default (back to the route if it's in the stack); `push` always adds
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

const RouterRoot = defineComponent(() => () => h(rootLayoutComponent ?? Stack))

// routeFiles: import.meta.glob('./app/**/*.vue', { eager: true })
export function createRouterApp(routeFiles) {
  for (const [filePath, module] of Object.entries(routeFiles)) {
    registerRouteFile(filePath, module.default)
  }

  routes.sort((first, second) => specificity(second) - specificity(first))
  stack.push(createEntry('/'))

  return createApp(RouterRoot)
}
