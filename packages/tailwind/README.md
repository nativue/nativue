# @nativue/tailwind

[Tailwind CSS](https://tailwindcss.com) classes for [nativue](https://github.com/nativue/nativue)
apps. The real Tailwind compiler runs when the app is built, and its CSS becomes native styles: the
app ships plain style objects, not Tailwind.

```sh
npm install @nativue/tailwind
```

Then add it to the plugins in `nativue.config.ts`, next to `package.json`:

```ts
import { defineConfig } from '@nativue/core/config'
import tailwind from '@nativue/tailwind'

export default defineConfig({
  plugins: [tailwind()],
})
```

```vue
<template>
  <View class="flex-row items-center gap-3 rounded-2xl bg-white p-4 shadow-md">
    <View class="size-10 rounded-full" :class="online ? 'bg-emerald-500' : 'bg-slate-300'" />
    <Text class="flex-1 text-lg font-semibold text-slate-900">Ada Lovelace</Text>
  </View>
</template>
```

- `class` and `:class` work on every native component, and on components that pass attributes
  down to one.
- `style` wins over `class`, as inline styles do on the web.
- Text styles (`text-*`, `font-*`) go on the `<Text>` itself: native views don't inherit them from
  their parents.

## Variants

- `active:` while a `<Pressable>` is pressed: `class="bg-brand active:bg-ink active:scale-95"`
- `focus:` while a `<TextInput>` has focus: `class="border-slate-200 focus:border-brand"`
- `disabled:` on a disabled `<Pressable>` or `<TextInput>`: `disabled:bg-slate-300`
- `dark:` in the system's dark mode, switching live with it
- `ios:` and `android:` on one platform
- combined: `dark:active:bg-black`

## Theme

Without a stylesheet, the app gets Tailwind's default theme. To change it, add `src/tailwind.css`:

```css
@import 'tailwindcss';

@theme {
  --color-brand: #0e9f84;
  --font-weight-bold: 800;
}
```

Then `bg-brand`, `text-brand`, `border-brand/50`... `@plugin` and `@config` (JavaScript
configuration) aren't supported.

## What converts

| Group      | Classes                                                                                                                                                                                                                                                                     |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spacing    | `p-*`, `px-*`, `pt-*`..., `m-*` (negative too), `gap-*`, `gap-x-*`, `gap-y-*`                                                                                                                                                                                               |
| Sizing     | `w-*`, `h-*`, `size-*`, `min-w-*`, `min-h-*`, `max-w-*`, `max-h-*`, fractions (`w-1/2`), `aspect-*`                                                                                                                                                                         |
| Flexbox    | `flex`, `flex-row`, `flex-col` and their reverses, `flex-wrap`, `flex-1`..., `grow`, `shrink`, `basis-*`, `items-*`, `justify-*`, `self-*`, `content-*`                                                                                                                     |
| Position   | `relative`, `absolute`, `static`, `inset-*`, `top-*`, `right-*`, `bottom-*`, `left-*`                                                                                                                                                                                       |
| Display    | `flex`, `inline-flex` (as `flex`), `hidden`, `overflow-hidden`, `overflow-visible`, `overflow-scroll`                                                                                                                                                                       |
| Colors     | `bg-*`, `text-*`, `border-*`, with opacity modifiers (`bg-black/50`)                                                                                                                                                                                                        |
| Gradients  | `bg-linear-*` (`bg-linear-to-r`, `bg-linear-45`), `bg-radial`, `bg-radial-[at_25%_25%]`, `from-*`, `via-*`, `to-*` and their positions (`from-10%`), `bg-[linear-gradient(…)]`                                                                                              |
| Borders    | `border`, `border-2`... (every side), `rounded-*`, and a side's or a corner's: `rounded-t-*`, `rounded-tl-*`, `rounded-s-*`...                                                                                                                                              |
| Text       | `text-{size}`, `font-{weight}`, `text-left`, `text-center`, `text-right`, `text-justify`, `underline`, `line-through`, `no-underline`, `italic`, `not-italic`, `uppercase`, `lowercase`, `capitalize`, `normal-case`, `tracking-*`, `leading-*`, `line-clamp-*`, `truncate` |
| Effects    | `opacity-*`, `shadow-*` (its first shadow)                                                                                                                                                                                                                                  |
| Transforms | `rotate-*`, `scale-*`, `scale-x-*`, `scale-y-*`, `translate-*`                                                                                                                                                                                                              |
| Arbitrary  | values (`bg-[#ff0000]`, `w-[72px]`) and properties, for the properties above                                                                                                                                                                                                |

Variants: `dark:`, `active:`, `focus:`, `disabled:`, `ios:` and `android:` (see above).

## What doesn't convert

Native views have no equivalent for these. They're left out, with a warning when the app is built
that names the class:

| Classes                                                                          | Why, and what to do instead                                                                                              |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `whitespace-*`, `break-*`, `indent-*`                                            | text wraps as the platform wraps it; `truncate` and `line-clamp-*` do convert                                            |
| `hover:`, `md:`, `lg:`..., `group-*`, `peer-*`, `first:`, `odd:`, `placeholder:` | no hover nor stylesheet: use `useWindowDimensions()` for sizes, and Vue for state (`:class="{ 'p-4': isWide }"`)         |
| `space-*`, `divide-*`                                                            | they style children: use `gap-*`, and borders on the children                                                            |
| `block`, `inline`, `grid`, `grid-cols-*`, `table`, `contents`                    | every view is a flexbox: use `flex-row`, `flex-wrap` and `basis-*`                                                       |
| `border-t`, `border-x`...                                                        | a border is the same on every side                                                                                       |
| `font-sans`, `font-serif`, `font-mono`                                           | text uses the system font                                                                                                |
| `z-*`                                                                            | views stack in the order they're written                                                                                 |
| `bg-conic`, `bg-[url(…)]`, `from-current`                                        | conic gradients and image backgrounds aren't drawn, and a gradient takes colors only: use `<ImageBackground>` for images |
| `shadow-*` past the first, `inset-shadow-*`, `ring-*`, `outline-*`               | a view has one shadow, outside it; a ring or an inset shadow leaves `shadow-*`'s alone                                   |
| `blur-*`, `backdrop-*`, `brightness-*` and other filters, `mix-blend-*`          | no filters on views                                                                                                      |
| `skew-*`, `perspective-*`, `rotate-x-*`, `origin-*`                              | transforms are translate, scale and rotate around the center                                                             |
| `transition-*`, `duration-*`, `animate-*`                                        | animate with `Animated` or `LayoutAnimation`                                                                             |
| `cursor-*`, `select-*`, `pointer-events-*`, `object-*`                           | no pointer, and `<Image>` has `resize-mode`                                                                              |

## How it works

At build time, quoted text in `src/` (`class="…"`, `:class="{ 'p-4': … }"`, strings in scripts) is
scanned for class names. Tailwind generates CSS for them, and every `.class { … }` rule becomes a
style object with its theme variables, `calc()` and colors (oklch included) resolved. Variants become
conditions. At run time, a class string is resolved once per state (color scheme, pressed, focused, disabled): the
utilities whose conditions hold, merged in Tailwind's order, so `p-4 px-2` keeps
`px-2`'s horizontal padding, as in CSS. Variables one class sets for another (`from-red-500` for
`bg-linear-to-r`) are kept until then, and resolved for the element.

Without Tailwind, see [Styling](https://github.com/nativue/nativue/blob/main/docs/styling.md).
