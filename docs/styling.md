# Styling

Components take a `style` object, with CSS properties in camelCase and numbers in points (no
units):

```vue
<View :style="{ padding: 16, borderRadius: 12, backgroundColor: '#ffffff' }" />
```

To use Tailwind classes instead, see [`@nativue/tailwind`](../packages/tailwind/README.md).

A `.vue` file's `<style>` block has no effect: native views don't read CSS, so the build warns and
leaves it out. Use style objects, or Tailwind's classes.

## StyleSheet

`StyleSheet.create` keeps a screen's styles together and types them, so `flexDirection: 'row'` is
checked instead of being any string:

```vue
<script setup lang="ts">
import { StyleSheet } from 'vue'

const styles = StyleSheet.create({
  card: { padding: 16, gap: 8, borderRadius: 12, backgroundColor: '#ffffff' },
  title: { fontSize: 17, fontWeight: '600' },
  selected: { borderWidth: 2, borderColor: '#0e9f84' },
})
</script>

<template>
  <View :style="[styles.card, isSelected && styles.selected]">
    <Text :style="styles.title">{{ title }}</Text>
  </View>
</template>
```

`:style` takes an array like on the web: later entries win, and `false` or `null` entries are
skipped.

## Layout: flexbox

Every view lays out its children with flexbox, as on the web, with two differences: children stack
in a **column** by default, and `flex: 1` means "take the space left".

| Property                         | Values                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| `flexDirection`                  | `'column'` (default), `'row'`, `'column-reverse'`, `'row-reverse'`                              |
| `justifyContent`                 | `'flex-start'`, `'flex-end'`, `'center'`, `'space-between'`, `'space-around'`, `'space-evenly'` |
| `alignItems`                     | `'stretch'` (default), `'flex-start'`, `'flex-end'`, `'center'`, `'baseline'`                   |
| `alignSelf`                      | `'auto'`, `'flex-start'`, `'flex-end'`, `'center'`, `'stretch'`, `'baseline'`                   |
| `alignContent`                   | `'flex-start'`, `'flex-end'`, `'center'`, `'stretch'`, `'space-between'`, `'space-around'`      |
| `flexWrap`                       | `'nowrap'`, `'wrap'`, `'wrap-reverse'`                                                          |
| `flex`, `flexGrow`, `flexShrink` | numbers                                                                                         |
| `flexBasis`                      | a size                                                                                          |
| `gap`, `rowGap`, `columnGap`     | numbers                                                                                         |
| `display`                        | `'flex'`, `'none'` (hides it)                                                                   |
| `overflow`                       | `'visible'`, `'hidden'` (clips children, e.g. to rounded corners), `'scroll'`                   |

Sizes are numbers (points), percentages (`'50%'`) or `'auto'`:

| Property                                                            |                                                                                                 |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `width`, `height`, `minWidth`, `minHeight`, `maxWidth`, `maxHeight` | a size                                                                                          |
| `aspectRatio`                                                       | a number: `16 / 9`                                                                              |
| `margin`, `padding`                                                 | a size; also `…Top`, `…Right`, `…Bottom`, `…Left`, `…Horizontal`, `…Vertical`, `…Start`, `…End` |
| `position`                                                          | `'relative'` (default), `'absolute'`, `'static'`                                                |
| `top`, `right`, `bottom`, `left`                                    | a size                                                                                          |

## Appearance

| Property                                                       |                                                                                                                                                          |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backgroundColor`                                              | a color                                                                                                                                                  |
| `backgroundImage`                                              | CSS gradients over the background color, see below                                                                                                       |
| `borderWidth`, `borderColor`                                   | the same on every side                                                                                                                                   |
| `borderRadius`                                                 | the same on every corner                                                                                                                                 |
| `opacity`                                                      | `0` to `1`                                                                                                                                               |
| `transform`                                                    | a list of steps: `[{ translateX: 10 }, { scale: 1.1 }, { rotate: '45deg' }]`; also `translateY`, `scaleX`, `scaleY`, and `rotate` in radians as a number |
| `shadowColor`, `shadowOpacity`, `shadowRadius`, `shadowOffset` | a shadow: `{ shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }`                                         |

### Gradients

`backgroundImage` takes CSS's `linear-gradient()` and `radial-gradient()`, as on the web. They follow
the view's corners, border and shadow:

```vue
<View
  :style="{
    height: 120,
    borderRadius: 16,
    backgroundImage: 'linear-gradient(135deg, #4af2ae, #10b39b)',
  }"
/>
```

- `linear-gradient`: an angle (`deg`, `rad`, `turn`, `grad`; `180deg`, top to bottom, by default) or
  `to` a side or corner (`to right`, `to top right`), then colors, each with an optional position in
  `%`.
- `radial-gradient`: `circle` or `ellipse`, sized by `closest-side`, `closest-corner`,
  `farthest-side`, `farthest-corner` (the default) or by lengths, `at` a position (`at top left`,
  `at 30% 40%`).
- Several, separated by commas, the first on top: `'radial-gradient(circle at top, white,
transparent 40%), linear-gradient(#10b39b, #0b1220)'`.

Not drawn: `repeating-linear-gradient()`, `repeating-radial-gradient()` and `conic-gradient()`; color
positions in lengths (`20px`) rather than `%`; and, on iOS, a gradient on a `<Text>` or an `<Image>`,
which would cover them: put it on a `<View>` around them.

## Text

These go on the [`<Text>`](components/text.md) (or the `<TextInput>`) itself: native views don't
inherit them from their parents.

| Property             |                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------ |
| `color`              | a color                                                                              |
| `fontSize`           | a number, scaled by the system's text size                                           |
| `fontWeight`         | `'normal'`, `'bold'`, `'100'` to `'900'`                                             |
| `textAlign`          | `'auto'`, `'left'`, `'right'`, `'center'`, `'justify'`                               |
| `textDecorationLine` | `'none'`, `'underline'`, `'line-through'`, `'underline line-through'`; `<Text>` only |

## Colors

Colors are CSS colors: `'#0e9f84'`, `'#0e9f8480'` (with alpha), `'#fff'`, `'rgb(14 159 132)'`,
`'rgba(0, 0, 0, 0.5)'`, and named colors (`'tomato'`, `'transparent'`).

## Dark mode

`useColorScheme()` follows the system's light or dark appearance, live:

```ts
import { computed, StyleSheet, useColorScheme } from 'vue'

const colorScheme = useColorScheme()
const styles = computed(() =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colorScheme.value === 'dark' ? '#0b1220' : '#f1f5f9' },
  }),
)
```

Components without a color of their own (text, inputs, headers, tab bars, sheets) already follow the
system's appearance. With Tailwind, use the `dark:` variant.

## Platform differences

```ts
import { Platform } from 'vue'

const styles = StyleSheet.create({
  title: { fontSize: Platform.select({ ios: 17, android: 16 }) },
})
```

`Platform.OS` is `'ios'` or `'android'`. With Tailwind, use the `ios:` and `android:` variants.

## States: pressed, focused, disabled

| State    | How to style it                                                                                                                  |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| pressed  | `pressed-style` on a [`Pressable`](components/pressable.md), merged over `style` while pressed. Its slot also gets `{ pressed }` |
| focused  | `focused-style` on a [`TextInput`](components/text-input.md), merged over `style` while it has focus                             |
| disabled | you set `disabled`, so pick the style with it: `:style="[styles.button, saving && styles.disabled]"`                             |

With Tailwind: `active:`, `focus:` and `disabled:` variants.
