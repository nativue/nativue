# @nativue/svg

Vector drawings in [nativue](https://github.com/nativue/nativue) apps, as on the web: write `<svg>` in
a template, with the elements you'd use in a browser. Charts, illustrations, SVGs exported from design
tools and Vue components written for the web that draw with SVG work as they are.

```sh
npm install @nativue/svg
```

Installing it is all: its plugin registers `<svg>` before the app starts. Rebuild the app
(`npm run ios`, `npm run android`), as for any package with native code.

```vue
<svg viewBox="0 0 200 100" width="300" height="150">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#4AF2AE" />
      <stop offset="100%" stop-color="#10B39B" stop-opacity="0" />
    </linearGradient>
  </defs>
  <path :d="area" fill="url(#fade)" />
  <polyline :points="line" fill="none" stroke="#0E9F84" stroke-width="2" />
  <circle v-for="point in points" :cx="point.x" :cy="point.y" r="4" fill="white" @press="select(point)" />
  <text x="100" y="16" text-anchor="middle" font-size="12" font-weight="bold">{{ title }}</text>
</svg>
```

Each `<svg>` is one native view: what's inside it stays in JavaScript and is drawn in one go, so a
chart with a thousand points stays light, and changing a value redraws it.

## Components

Every element is also a component, named after it (`Svg`, `G`, `Path`, `Circle`, `Text`, `Image`,
`LinearGradient`, `ClipPath`, `FeDropShadow`...), which renders the lowercase element. Import the ones
you use; `Text` and `Image` are nativue's too, so rename them:

```vue
<script setup lang="ts">
import { Circle, Path, Svg, Text as SvgText } from '@nativue/svg'
</script>

<template>
  <Svg viewBox="0 0 24 24" width="48" height="48">
    <Circle cx="12" cy="12" r="10" fill="#4AF2AE" />
    <Path d="M8 12h8" stroke="#0B1220" stroke-width="2" stroke-linecap="round" />
    <SvgText x="12" y="22" text-anchor="middle" font-size="4">Go</SvgText>
  </Svg>
</template>
```

## What it draws

| Element                                                            | Attributes                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `svg`                                                              | `viewBox`, `width`, `height` (they size it; `style` too), `preserveAspectRatio` (`xMidYMid meet` by default; any alignment, `slice` or `none`)                                                                                                                                                                                                                                                                                     |
| `path`, `circle`, `ellipse`, `rect`, `line`, `polyline`, `polygon` | their geometry: `d`, `cx`/`cy`/`r`, `x`/`y`/`width`/`height`/`rx`/`ry`, `points`...                                                                                                                                                                                                                                                                                                                                                |
| `g`                                                                | groups: what it sets is inherited by what's inside                                                                                                                                                                                                                                                                                                                                                                                 |
| `text`, `tspan`                                                    | `x`, `y` (the baseline), `dx`, `dy`, `font-size`, `font-weight`, `font-family`, `text-anchor`, `dominant-baseline`, `letter-spacing`, `font-style`, `text-decoration`; a `tspan` with its own `x`, `y` or `dy` starts a new line or place, with its own style; filled with a color, gradient or pattern, and stroked                                                                                                               |
| `textPath`                                                         | inside a `text`: its text along a `path`, `href="#id"`, `startOffset` (a length or a percentage of the path)                                                                                                                                                                                                                                                                                                                       |
| `image`                                                            | `href` (a url, or an imported image as for `<Image>`), `x`, `y`, `width`, `height`, `preserveAspectRatio`                                                                                                                                                                                                                                                                                                                          |
| `defs`, `linearGradient`, `radialGradient`, `stop`                 | gradients, as `fill="url(#id)"` or `stroke="url(#id)"`: `x1`/`y1`/`x2`/`y2`, `cx`/`cy`/`r`/`fx`/`fy`, `gradientUnits`, `gradientTransform`, `spreadMethod` (`pad`, `reflect`, `repeat`), `href` (another gradient's stops and attributes), `offset`, `stop-color`, `stop-opacity`                                                                                                                                                  |
| `pattern`                                                          | `fill="url(#id)"`: its content tiled; `x`, `y`, `width`, `height`, `patternUnits`, `patternContentUnits`, `patternTransform`, `viewBox`, `href`                                                                                                                                                                                                                                                                                    |
| `marker`                                                           | `marker-start`, `marker-mid`, `marker-end` on a `path`, `line`, `polyline` or `polygon`: its content at the vertices; `markerWidth`, `markerHeight`, `markerUnits`, `refX`, `refY`, `orient` (`auto`, `auto-start-reverse`, an angle), `viewBox`                                                                                                                                                                                   |
| `clipPath`                                                         | `clip-path="url(#id)"`: only what its shapes cover is drawn; `clipPathUnits`, `clip-rule`                                                                                                                                                                                                                                                                                                                                          |
| `mask`                                                             | `mask="url(#id)"`: drawn where the mask's content is light (its luminance), or opaque with `mask-type="alpha"`                                                                                                                                                                                                                                                                                                                     |
| `symbol`, `use`                                                    | `<use href="#id" x y width height>` draws a copy of an element, or of a `symbol` fitted to its `viewBox`; `xlink:href` works too                                                                                                                                                                                                                                                                                                   |
| `filter`                                                           | `filter="url(#id)"`: `feDropShadow` (`dx`, `dy`, `stdDeviation`, `flood-color`, `flood-opacity`); the drop and inner shadows design tools export, any number of them (`feOffset`, `feGaussianBlur`, an `feColorMatrix` or `feFlood` for the color, `feComposite operator="arithmetic"` for an inner one); and, on the element itself, `feGaussianBlur` and `feColorMatrix` (`matrix`, `saturate`, `hueRotate`, `luminanceToAlpha`) |
| `style`                                                            | its rules apply to the elements they select: tags, `.classes` and `#ids`, combined and nested, as design tools export them (static `class` and `id` only)                                                                                                                                                                                                                                                                          |
| `a`                                                                | drawn as a `g`                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `title`, `desc`, `metadata`                                        | kept out of the drawing                                                                                                                                                                                                                                                                                                                                                                                                            |

On any element: `fill`, `stroke` (a color, `none`, `currentColor` or `url(#id)`), `stroke-width`,
`stroke-linecap`, `stroke-linejoin`, `stroke-miterlimit`, `stroke-dasharray`, `stroke-dashoffset`,
`opacity`, `fill-opacity`, `stroke-opacity`, `fill-rule`, `paint-order`, `vector-effect="non-scaling-stroke"`,
`display="none"`, `visibility` and `transform` (`translate`, `scale`, `rotate`, `skewX`, `skewY`,
`matrix`), also as `style="fill: red; stroke-width: 2"`. Like in SVG, `fill` defaults to black, and
`stroke` to none. Lengths take `px`, `pt`, `pc`, `in`, `cm`, `mm`, `em` and `ex`. Percentages are of
the `viewBox` (`width="100%"`, `x="50%"`), and of the shape's box in gradients and stops' `offset`. `width` and `height` on `<svg>` size it under its
`class` and `style`, as on the web.

Animating `stroke-dashoffset` from the line's length to 0 draws it in, as on the web.

## .svg files

An imported `.svg` file is a component, its props passed to its `<svg>`:

```vue
<script setup lang="ts">
import Logo from '@/assets/logo.svg'
</script>

<template>
  <Logo width="120" height="40" />
</template>
```

For its type, add to `src/env.d.ts`:

```ts
/// <reference types="@nativue/svg/client" />
```

## What it doesn't do

- `foreignObject`: it holds HTML, which native apps don't have. Lay nativue views over the `<svg>`
  instead.
- SMIL animation (`<animate>`, `<animateTransform>`, `<set>`): animate attributes from Vue (a `ref` in
  `:stroke-dashoffset`), or with `Animated`.
- Filters other than the ones above (`feTurbulence`, `feMorphology`, lighting, `feImage`...): the
  element is drawn without the filter.
- Gestures other than `@press` on elements (a long press, a drag): put the `<svg>` in a view that takes
  them.
- `textLength` and `lengthAdjust`, vertical text, `rotate` per character, and a `tspan` inside a
  `textPath`.
- `<switch>`, which picks what to draw by the browser's features.
- An `<svg>` inside another: draw its content in a `g` with a `transform` instead.
- `<title>` and `<desc>` as what screen readers say: give the `<svg>` an `aria-label` and `role="img"`.

And its limits:

- A marker's content isn't clipped to its box, and on an arc a marker turns with the arc's chord.
- On Android before 12, a radial gradient's `fx` and `fy` are ignored.

## Taps

`@press` on an element is called when it's tapped, with where: `{ x, y }`, in points from the view's
corner. It goes on to the `g`s around it and to the `<svg>`'s own `@press`, as a click does on the
web, but not to a `<Pressable>` around the `<svg>`: a tap on an element is the drawing's. A tap where
no element takes it goes to what contains the `<svg>`. Thin elements, like a line, can be tapped
within 44 points of them.

## Tab and header icons

`svgIcon` makes your own shapes a tab bar or header icon, tinted by the bar like an icon set's
(stroked with round caps and joins; a shape whose `fill` isn't `none` is filled too):

```ts
import { svgIcon } from '@nativue/svg'

const options = {
  tabBarIcon: svgIcon([0, 0, 24, 24], [['path', { d: 'M3 12h18M12 3v18' }]]),
}
```

## Icons

[`@nativue/icons`](../icons/README.md) draws with the same view, and brings this package with it. Its
components pass the icon's shapes as `elements`, `[tag, attributes]` pairs stroked with `color`:

```vue
<Svg
  :view-box="[0, 0, 24, 24]"
  :elements="[['circle', { cx: 12, cy: 12, r: 10 }]]"
  color="#0e9f84"
/>
```
