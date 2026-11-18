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

Spacing (`p-*`, `m-*`, `gap-*`, negative margins), sizing (`w-*`, `h-*`, `size-*`, `min-*`,
`max-*`, fractions, `aspect-*`), flexbox (`flex-*`, `grow`, `shrink`, `basis-*`, `items-*`,
`justify-*`, `self-*`, `content-*`), position (`absolute`, `inset-*`, `top-*`...), `hidden`,
`overflow-*`, colors with opacity modifiers (`bg-*`, `text-*`, `border-*`), `border`,
`rounded-*`, `opacity-*`, `text-{size}`, `font-{weight}`, `text-{align}`, `rotate-*`, `scale-*`,
`translate-*`, `shadow-*` (its first shadow) and arbitrary values (`bg-[#ff0000]`, `w-[72px]`).

What native views have no equivalent for is left out, with a warning when the app is built: other
variants (`hover:`, `md:`, `group-*`...), `space-*` and `divide-*` (they style children),
`z-*`, `leading-*`, `tracking-*`, per-corner radius and per-side borders.

## How it works

At build time, quoted text in `src/` (`class="…"`, `:class="{ 'p-4': … }"`, strings in scripts) is
scanned for class names. Tailwind generates CSS for them, and every `.class { … }` rule becomes a
style object with its theme variables, `calc()` and colors (oklch included) resolved. Variants become
conditions. At run time, a class string is resolved once per state (color scheme, pressed): the
utilities whose conditions hold, merged in Tailwind's order, so `p-4 px-2` keeps
`px-2`'s horizontal padding, as in CSS.
