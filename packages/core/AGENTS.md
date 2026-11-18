# nativue: guide for coding agents

This app is built with nativue: Vue 3 single-file components rendered as real native views on iOS and
Android. It is not a web app. There is no DOM, no browser and no CSS, so web habits produce code that
doesn't work. Full docs: https://github.com/nativue/nativue/tree/main/docs

## What doesn't exist

- HTML elements (`<div>`, `<span>`, `<p>`, `<img>`, `<button>`, `<input>`, `<ul>`...): use the
  components below.
- CSS: `<style>` blocks, class names from a stylesheet, `px`/`rem`/`em` units, `:hover`, media queries.
  A `.vue` file's `<style>` block is left out of the build.
- Browser globals: `window`, `document`, `localStorage`, `sessionStorage`, `navigator`, `alert`.
  Use `AsyncStorage` for storage.
- Vue Router and `main.ts`: routing is file-based (below), and nativue creates the app.

## Components

Global, with no import: `View`, `Text`, `Image`, `ImageBackground`, `Pressable`, `Button`, `TextInput`,
`Switch`, `ScrollView`, `FlatList`, `Swipeable`, `Modal`, `ActivityIndicator`, `SafeAreaView`,
`KeyboardAvoidingView`, `Svg`.

- Text must be inside a `<Text>`, never directly in a `<View>`.
- Taps: `<Pressable @press="save">` (also `@long-press`, and `v-slot="{ pressed }"`), or
  `<Button title="Save" @press="save" />`. There is no `@click`.
- Inputs: `<TextInput v-model="name" placeholder="Name" @submit-editing="save" />`.
- Images: `import logo from '@/assets/logo.png'` then `<Image :source="logo" />`; remote ones as
  `:source="{ uri: url }"`. A remote image has no size until it loads: give it a width and height
  where the layout shouldn't jump, like a list's rows.
- Long lists: `<FlatList :data="items" :key-extractor="(item) => item.id">` with a
  `<template #item="{ item }">` slot, not `v-for` in a `ScrollView`.

## Styling

- `style` takes an object with CSS properties in camelCase and numbers in points, no units:
  `:style="{ padding: 16, borderRadius: 12, backgroundColor: '#ffffff' }"`. Arrays merge, later wins:
  `:style="[styles.card, selected && styles.selected]"`.
- `StyleSheet.create({...})` (from `vue`) groups and types a screen's styles.
- Every view is a flexbox container stacking its children in a **column** by default; `flex: 1` takes
  the space left. Percentages (`'50%'`) work for sizes.
- Text styles (`color`, `fontSize`, `fontWeight`, `textAlign`, `textDecorationLine`) go on the
  `<Text>` itself: native views don't inherit them from their parents.
- Pressed and focused states: `pressed-style` on `Pressable`, `focused-style` on `TextInput`.
- Dark mode: `useColorScheme()` (from `vue`) gives `'light'` or `'dark'`, live.
- Platform: `Platform.OS` is `'ios'` or `'android'`; `Platform.select({ ios, android })`.
- If the app uses `@nativue/tailwind` (see `nativue.config.ts`), Tailwind classes work in `class`,
  with the `active:`, `focus:`, `disabled:`, `dark:`, `ios:` and `android:` variants.

## Navigation

Every `.vue` file in `src/app` is a screen, and its path is its URL:

| File                  | URL                                                    |
| --------------------- | ------------------------------------------------------ |
| `app/index.vue`       | `/`                                                    |
| `app/items/[id].vue`  | `/items/42`, param `id`                                |
| `app/(tabs)/home.vue` | `/home`: a folder in parentheses groups without a path |
| `app/_layout.vue`     | the layout of its folder: a `<Stack>` or a `<Tabs>`    |
| `app/+not-found.vue`  | shown when no route matches                            |

Import navigation from `@nativue/core/router`:

- `<Link href="/items/42">` (a Pressable); `router.push(path)`, `router.navigate(path)`,
  `router.replace(path)`, `router.back()`.
- `useLocalSearchParams<{ id: string }>()` reads params and the query string.
- `<Stack.Screen :options="{ title: 'Item' }" />` inside a screen sets its header; in a layout,
  `<Stack.Screen name="modal" :options="{ presentation: 'modal' }" />` sets a route's options.

## APIs

Import the runtime from `vue`: `ref`, `computed`, `StyleSheet`, `Animated`, `LayoutAnimation`,
`Platform`, `AsyncStorage`, `Keyboard`, `Dimensions`, `useWindowDimensions`, `useColorScheme`,
`AccessibilityInfo`, `requireNativeFunction`.

- `AsyncStorage`: `getItem`, `setItem`, `removeItem`, `getAllKeys`, `multiGet`, `multiSet`,
  `clear`; promise-based, string values. Store objects as JSON. For large data or queries, use
  `@nativue/sqlite`.
- `fetch`, `XMLHttpRequest`, `Blob`, `FileReader`, `URL`, `URLSearchParams`, timers and `console`
  work as on the web, with no import.
- Accessibility: `role` and `aria-*` attributes (`aria-label`, `aria-hidden`...) on any component.

## Project

- `@/` points at `src/`. Shared components go in `src/components`, everything else in `src/lib`.
- Vue plugins (Pinia...) are installed in `src/app.ts`: `export default function setup(app: App)`.
- Official packages: `@nativue/icons` (icon components), `@nativue/tailwind`, `@nativue/haptics`,
  `@nativue/sqlite`. A package with native code needs the app rebuilt with `npm run ios` or
  `npm run android`, not just a reload.
- Commands: `npm run ios` / `npm run android` build and open the app, then reload on save;
  `npm run typecheck` checks scripts and templates; `npm run build` makes the release bundle;
  `npm run format` formats with Prettier.
- Native code the app needs (a platform API no package covers) goes in `native/<name>/ios` and
  `native/<name>/android`, as `<Name>Plugin` classes registering functions JavaScript calls with
  `requireNativeFunction`; see the docs' "Native code in your app". Rebuild after changing it.
- Check changes with `npm run typecheck`. `ios/` and `android/` are the native host apps: change them
  only for native settings (permissions in `Info.plist` or `AndroidManifest.xml`, the app's name and
  icon).
