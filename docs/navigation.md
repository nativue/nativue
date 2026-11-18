# Navigation

Every `.vue` file in `src/app` is a screen, and its path is its URL. Screens open in native
navigation: UIKit's navigation and tab bars on iOS; Material 3 app bars, bottom navigation and the
system back gesture on Android.

## Routes

| File                     | URL                                                                    |
| ------------------------ | ---------------------------------------------------------------------- |
| `app/index.vue`          | `/`                                                                    |
| `app/settings.vue`       | `/settings`                                                            |
| `app/items/[id].vue`     | `/items/42`, with the param `id`                                       |
| `app/docs/[...rest].vue` | any path under `/docs`; `rest` is an array                             |
| `app/(tabs)/home.vue`    | `/home`: a folder in parentheses groups files without changing the URL |
| `app/+not-found.vue`     | shown when no route matches                                            |
| `app/_layout.vue`        | the layout of the routes in its folder (see below)                     |

Read the params in the screen:

```ts
import { useLocalSearchParams } from '@nativue/core/router'

const { id } = useLocalSearchParams<{ id: string }>()
```

Query strings are params too: `/search?q=shoes` gives `q`.

## Layouts

A `_layout.vue` decides how the routes in its folder are shown: in a `<Stack>` (screens pushed on top
of each other, with a back button) or in `<Tabs>` (a tab bar). Without one, the app's root is a
`<Stack>`.

```vue
<!-- app/_layout.vue -->
<script setup lang="ts">
import { Stack } from '@nativue/core/router'
</script>

<template>
  <Stack :screen-options="{ headerLargeTitle: true }">
    <Stack.Screen name="modal" :options="{ presentation: 'modal', title: 'New post' }" />
  </Stack>
</template>
```

```vue
<!-- app/(tabs)/_layout.vue -->
<script setup lang="ts">
import { HouseIcon, SettingsIcon } from '@nativue/icons/lucide'
import { Tabs } from '@nativue/core/router'
</script>

<template>
  <Tabs :screen-options="{ tabBarActiveTintColor: '#0e9f84' }">
    <Tabs.Screen name="index" :options="{ title: 'Home', tabBarIcon: HouseIcon }" />
    <Tabs.Screen name="settings" :options="{ title: 'Settings', tabBarIcon: SettingsIcon }" />
  </Tabs>
</template>
```

Layouts nest: a folder inside a tab can have its own `_layout.vue` with a `<Stack>`, so each tab keeps
its own history.

- `<Stack>` and `<Tabs>` take `screen-options`: options for every screen in them.
- `<Stack.Screen name="…">` and `<Tabs.Screen name="…">` inside them set the options of the route
  with that name (its file name, without `.vue`). In `<Tabs>`, they also set the tabs' order.
- `<Stack.Screen :options>` inside a screen sets that screen's own options, and can change them
  later:

```vue
<!-- app/items/[id].vue -->
<template>
  <Stack.Screen :options="{ title: item.name }" />
  …
</template>
```

## Screen options

| Option                                             | Type                                                    | Description                                                               |
| -------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------- |
| `title`                                            | `string`                                                | the header's title, and the tab's label                                   |
| `headerShown`                                      | `boolean`                                               | `false` hides the header                                                  |
| `headerLargeTitle`                                 | `boolean`                                               | iOS's large title, which collapses as the content scrolls                 |
| `headerBackTitle`                                  | `string`                                                | the back button's text on the next screen (iOS)                           |
| `headerTintColor`                                  | `string`                                                | the color of the header's buttons                                         |
| `headerRight`, `headerLeft`                        | `HeaderItem[]`                                          | buttons in the header, see below                                          |
| `presentation`                                     | `'card' \| 'modal' \| 'formSheet' \| 'fullScreenModal'` | how the screen opens, see below                                           |
| `tabBarLabel`                                      | `string`                                                | the tab's label, when it differs from `title`                             |
| `tabBarIcon`                                       | an icon component, or an SF Symbol name                 | the tab's icon                                                            |
| `tabBarBadge`                                      | `string \| number`                                      | a badge on the tab                                                        |
| `tabBarActiveTintColor`, `tabBarInactiveTintColor` | `string`                                                | the tab bar's colors: set them in `<Tabs :screen-options>`                |
| `tabBarBackgroundColor`                            | `string`                                                | the tab bar's background (Android and iOS 18; iOS 26 keeps its glass bar) |
| `lazy`                                             | `boolean`                                               | in `<Tabs>`: builds the tab only when it's first opened                   |

Icons from [`@nativue/icons`](../packages/icons/README.md) work on both platforms. SF Symbol names
(`tabBarIcon: 'house'`) are iOS only.

### Header buttons

```ts
const options = {
  headerRight: [{ title: 'Add', icon: PlusIcon, onPress: () => router.push('/new') }],
}
```

A `HeaderItem` has a `title`, an optional `icon` (shown instead of the title, which still names it
for screen readers) and `onPress`.

## Navigating

From a template, with `<Link>`, which is a [`Pressable`](components/pressable.md):

```vue
<script setup lang="ts">
import { Link } from '@nativue/core/router'
</script>

<template>
  <Link :href="`/items/${item.id}`" :style="styles.row">
    <Text>{{ item.name }}</Text>
  </Link>
</template>
```

| Prop      | Description               |
| --------- | ------------------------- |
| `href`    | where to go               |
| `push`    | always opens a new screen |
| `replace` | swaps the current screen  |

Without `push` or `replace`, a `Link` navigates: it goes back to the route if it's already in the
stack, or opens it otherwise.

From code, with `router` (or `useRouter()`):

```ts
import { router } from '@nativue/core/router'

router.push('/items/42') // opens a new screen
router.navigate('/items/42') // goes back to it if it's in the stack, or opens it
router.replace('/login') // swaps the current screen
router.back() // closes the current screen, or a modal
router.canGoBack() // whether back() has somewhere to go
router.dismissAll() // back to the first screen of the stack
```

Opening a route in another tab switches to that tab.

## Modals and sheets

A route opens as a modal with `presentation`, set in its layout:

```vue
<Stack.Screen name="new-post" :options="{ presentation: 'modal', title: 'New post' }" />
```

| `presentation`      | Opens as                                                                           |
| ------------------- | ---------------------------------------------------------------------------------- |
| `'card'`            | pushed on the stack (the default)                                                  |
| `'modal'`           | a card over the screen, with its own header; screens pushed from it open inside it |
| `'formSheet'`       | a sheet: a native sheet on iOS, a Material bottom sheet on Android                 |
| `'fullScreenModal'` | covers the whole screen                                                            |

`router.back()` closes it, as does swiping it down. For a modal driven by a ref, without a route,
use [`<Modal>`](components/modal.md).

## Focus

```ts
import { useFocusEffect, useIsFocused } from '@nativue/core/router'

// A ref: whether this screen is the one on screen.
const isFocused = useIsFocused()

// Runs whenever the screen gains focus; the returned function runs when it loses it.
useFocusEffect(() => {
  refresh()
  const timer = setInterval(refresh, 5000)

  return () => clearInterval(timer)
})
```

`usePathname()` returns the screen's path, as it was when the screen opened.

## Deep links

Every app has a URL scheme, from its name: `my-app` opens links like `myapp://items/42`, which
navigate to `/items/42`. Change the scheme in `ios/Info.plist` (`CFBundleURLSchemes`) and in
`android/app/src/main/AndroidManifest.xml`.

Try it on a simulator with `xcrun simctl openurl booted myapp://items/42`, or on an emulator with
`adb shell am start -a android.intent.action.VIEW -d myapp://items/42`.
