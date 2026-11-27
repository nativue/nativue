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
`KeyboardAvoidingView`.

- Charts and drawings: `<svg>` as on the web, with `@nativue/svg` installed (`@nativue/icons` brings
  it): shapes, `text`/`tspan`/`textPath`, gradients and `pattern`s in `defs` (`fill="url(#id)"`),
  `clipPath`, `mask`, `use`/`symbol`, `marker`, `image`, drop shadows and blur filters, and `@press`
  on an element. Also as components to import: `import { Svg, Path, Text as SvgText } from
'@nativue/svg'` (rename `Text` and `Image`, which are nativue's). Without the package, `<svg>`
  shows nothing. An imported `.svg` file is a component (`import Logo from '@/assets/logo.svg'`, with
  `/// <reference types="@nativue/svg/client" />` in `src/env.d.ts`), and a `<style>` inside an `<svg>`
  styles its elements by tag, class and id.

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
- Gradients: `backgroundImage: 'linear-gradient(135deg, #4af2ae, #10b39b)'` or `radial-gradient(...)`,
  as in CSS, on a `View`; with Tailwind, `bg-linear-to-r from-emerald-400 to-teal-600`.
- Every view is a flexbox container stacking its children in a **column** by default; `flex: 1` takes
  the space left. Percentages (`'50%'`) work for sizes.
- Text styles (`color`, `fontSize`, `fontWeight`, `fontStyle`, `textAlign`, `textDecorationLine`,
  `textTransform`, `letterSpacing`, `lineHeight`, `lineClamp`) go on the `<Text>` itself: native views
  don't inherit them from their parents.
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
`AccessibilityInfo`, `requireNativeFunction`, `addNativeListener`, `onOpenURL`, `AppState`,
`NativeError`, `usePermission`, `openSettings`.

- Native events: `addNativeListener('camera.captured', (payload) => ...)` returns a subscription;
  in a component it's removed on unmount. `addNativeListener('app.state', (state) => ...)` and
  `AppState.current` say whether the app is `'active'` or `'background'`.
- A rejected native call is a `NativeError` with a `code`: `ERR_PERMISSION_DENIED`,
  `ERR_UNAVAILABLE`, `ERR_CANCELED`, `ERR_INVALID_ARGUMENT`.
- `onOpenURL((url) => true)` takes a URL the app was opened with before the router does.
- Permissions: `const { permission, request } = usePermission(Camera.getPermission, Camera.requestPermission)`
  gives `{ status, granted, canAskAgain }`, re-read when the app comes back to the front. When
  `!granted && !canAskAgain`, only `openSettings()` can help: explain why, then offer it.

- `AsyncStorage`: `getItem`, `setItem`, `removeItem`, `getAllKeys`, `multiGet`, `multiSet`,
  `clear`; promise-based, string values. Store objects as JSON. For large data or queries, use
  `@nativue/sqlite`.
- `fetch`, `XMLHttpRequest`, `Blob`, `FileReader`, `URL`, `URLSearchParams`, timers and `console`
  work as on the web, with no import.
- Accessibility: `role` and `aria-*` attributes (`aria-label`, `aria-hidden`...) on any component.

## Project

- `@/` points at `src/`. Shared components go in `src/components`, everything else in `src/lib`.
- Vue plugins (Pinia...) are installed in `src/app.ts`: `export default function setup(app: App)`.
- Tab and header icons (`tabBarIcon`, a header item's `icon`): an `@nativue/icons` component,
  `svgIcon(viewBox, elements)` from `@nativue/svg`, an image `{ uri }`, or an SF Symbol name (iOS).
- Official packages: `@nativue/svg`, `@nativue/icons` (icon components), `@nativue/tailwind`, `@nativue/haptics`,
  `@nativue/clipboard` (copy text), `@nativue/notifications` (local notifications), `@nativue/sqlite`,
  `@nativue/image-picker` (`ImagePicker.pick({ limit, mediaTypes })`, `takePhoto()`; call
  `getPendingResult()` on start, for a photo taken while Android closed the app).
  A package with native code needs the app
  rebuilt with `npm run ios` or `npm run android`, not just a reload.
- Notifications: `Notifications.schedule({ title, body, data }, { seconds } | { date } | { hour, minute } | null)`
  after `usePermission(Notifications.getPermission, Notifications.requestPermission)` says granted.
  Handle taps with `Notifications.onResponse` and, on start, `Notifications.getLastResponse()` (the tap
  that opened the app); each tap reaches only one of them.
  A custom sound is a `.wav` listed in `notifications({ sounds: [...] })`, played with
  `schedule({ sound: 'chime.wav' })`; on Android 8+ it's the channel's: `setChannel({ id: 'orders', name, sound })`, then
  `schedule({ ..., sound: 'chime.wav', channelId: 'orders' })`.
- Copying: `const { copied, systemConfirmed } = await Clipboard.copy(text)`; show a "copied" toast
  only when `copied && !systemConfirmed` (Android 13+ shows its own).
- Commands: `npm run ios` / `npm run android` build and open the app, then update it on save
  (template edits keep the component's state; script edits re-create the component);
  `npm run typecheck` checks scripts and templates; `npm run build` makes the release bundle;
  `npm run format` formats with Prettier.
- Native code the app needs (a platform API no package covers) goes in `native/<name>/ios` and
  `native/<name>/android`, as `<Name>Plugin` classes registering functions JavaScript calls with
  `requireNativeFunction`; libraries it uses (Swift packages, Maven) go in `native/<name>/nativue.json`.
  See the docs' "Native code in your app". Rebuild after changing it. On Android, use
  `registry.applicationContext`, and `registry.activity` only when needed, without keeping it. App
  events (push token, notification taps, URLs, activity results) reach plugins implementing
  `AppLifecycleListener` / `NotificationCenterListener` (iOS) or `ActivityListener` (Android).
- An iOS app extension (a widget, a Notification Service, a share extension) goes in
  `native/extensions/<name>/`: plain Swift files, plus a `nativue.json` with its `ios.target` (`type`,
  `bundleIdSuffix`). See the docs' "iOS app extensions". `ios.appGroups` in `nativue.config.ts`
  shares data with it.
- Check changes with `npm run typecheck`.
- `ios/` and `android/` are generated from `nativue.config.ts` (name, scheme, ids, version,
  buildNumber, icon, splash, `ios.infoPlist`, `ios.entitlements`, `android.permissions`,
  `android.blockedPermissions`, `android.adaptiveIcon`, `android.signing`, `android.gradle`,
  `resources`) by `npx nativue prebuild`, which `dev`, `build` and `run` also run: never edit them,
  nor commit them. Prebuild stops with an error when they were changed by hand. An app with
  `prebuild: false` in `nativue.config.ts` keeps them by hand instead.
