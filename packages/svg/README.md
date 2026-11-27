# @nativue/svg

Vector drawings in [nativue](https://github.com/nativue/nativue) apps, as on the web: write `<svg>` in
a template, with the elements you'd use in a browser. Charts, illustrations, SVGs exported from design
tools and Vue components written for the web that draw with SVG work as they are.

```sh
npm install @nativue/svg
```

Installing it is all: its plugin registers `<svg>` before the app starts. Rebuild the app
(`npm run ios`, `npm run android`), as for any package with native code. For the components' types
in templates, add to `src/env.d.ts`:

```ts
/// <reference types="@nativue/svg" />
```

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

The same elements are also components, for those who prefer them: `Svg`, `G`, `Path`, `Circle`,
`Ellipse`, `Rect`, `Line`, `Polyline`, `Polygon`, `SvgText` (`<Text>` is nativue's text), `Tspan`,
`Defs`, `LinearGradient`, `RadialGradient` and `Stop`. They're global and render the lowercase
element: an app's own component with one of these names (a `Line.vue` it imports) is used instead.

```vue
<Svg viewBox="0 0 24 24" width="48" height="48">
  <Circle cx="12" cy="12" r="10" fill="#4AF2AE" />
  <Path d="M8 12h8" stroke="#0B1220" stroke-width="2" stroke-linecap="round" />
</Svg>
```

## What it draws

| Element                                                            | Attributes                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `svg`                                                              | `viewBox`, `width`, `height` (they size it; `style` too), `preserveAspectRatio` (`xMidYMid meet` by default; any alignment, `slice` or `none`)                                                                                                                                    |
| `path`, `circle`, `ellipse`, `rect`, `line`, `polyline`, `polygon` | their geometry: `d`, `cx`/`cy`/`r`, `x`/`y`/`width`/`height`/`rx`/`ry`, `points`...                                                                                                                                                                                               |
| `g`                                                                | groups: what it sets is inherited by what's inside                                                                                                                                                                                                                                |
| `text`, `tspan`                                                    | `x`, `y` (the baseline), `dx`, `dy`, `font-size`, `font-weight`, `font-family`, `text-anchor`, `dominant-baseline`, `letter-spacing`; a `tspan` with its own `x`, `y` or `dy` starts a new line or place, with its own style                                                      |
| `textPath`                                                         | inside a `text`: its text along a `path`, `href="#id"`, `startOffset` (a length or a percentage of the path)                                                                                                                                                                      |
| `image`                                                            | `href` (a url, or an imported image as for `<Image>`), `x`, `y`, `width`, `height`, `preserveAspectRatio`                                                                                                                                                                         |
| `defs`, `linearGradient`, `radialGradient`, `stop`                 | gradients, as `fill="url(#id)"` or `stroke="url(#id)"`: `x1`/`y1`/`x2`/`y2`, `cx`/`cy`/`r`/`fx`/`fy`, `gradientUnits`, `gradientTransform`, `spreadMethod` (`pad`, `reflect`, `repeat`), `href` (another gradient's stops and attributes), `offset`, `stop-color`, `stop-opacity` |
| `pattern`                                                          | `fill="url(#id)"`: its content tiled; `x`, `y`, `width`, `height`, `patternUnits`, `patternContentUnits`, `patternTransform`, `viewBox`, `href`                                                                                                                                   |
| `marker`                                                           | `marker-start`, `marker-mid`, `marker-end` on a `path`, `line`, `polyline` or `polygon`: its content at the vertices; `markerWidth`, `markerHeight`, `markerUnits`, `refX`, `refY`, `orient` (`auto`, `auto-start-reverse`, an angle), `viewBox`                                  |
| `clipPath`                                                         | `clip-path="url(#id)"`: only what its shapes cover is drawn; `clipPathUnits`, `clip-rule`                                                                                                                                                                                         |
| `mask`                                                             | `mask="url(#id)"`: drawn where the mask's content is light (its luminance)                                                                                                                                                                                                        |
| `symbol`, `use`                                                    | `<use href="#id" x y width height>` draws a copy of an element, or of a `symbol` fitted to its `viewBox`; `xlink:href` works too                                                                                                                                                  |
| `filter`                                                           | `filter="url(#id)"`: an `feDropShadow` (`dx`, `dy`, `stdDeviation`, `flood-color`, `flood-opacity`); the drop shadow design tools export (`feOffset`, `feGaussianBlur` and an `feColorMatrix` or `feFlood` for its color); or an `feGaussianBlur` alone, a blur                   |
| `title`, `desc`, `metadata`                                        | kept out of the drawing                                                                                                                                                                                                                                                           |

On any element: `fill`, `stroke` (a color, `none`, `currentColor` or `url(#id)`), `stroke-width`,
`stroke-linecap`, `stroke-linejoin`, `stroke-miterlimit`, `stroke-dasharray`, `stroke-dashoffset`,
`opacity`, `fill-opacity`, `stroke-opacity`, `fill-rule`, `display="none"` and `transform`
(`translate`, `scale`, `rotate`, `skewX`, `skewY`, `matrix`), also as `style="fill: red; stroke-width: 2"`. Like in SVG, `fill` defaults to
black, and `stroke` to none. Percentages are of the `viewBox` (`width="100%"`, `x="50%"`), and of the
shape's box in gradients and stops' `offset`. `width` and `height` on `<svg>` size it under its
`class` and `style`, as on the web.

Animating `stroke-dashoffset` from the line's length to 0 draws it in, as on the web.

Not drawn: `foreignObject`, a nested `<svg>`, filters other than the ones above (their element is
drawn as it is), and a `<style>` element (Vue leaves `<style>` out of templates: use `style=""`). A
marker's content isn't clipped to its box, and on an arc a marker turns with the arc's chord. On
Android before 12, a radial gradient's `fx` and `fy` are ignored.

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
