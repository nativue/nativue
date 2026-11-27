# Svg

Vector drawings, as on the web: write `<svg>` in a template, with the elements you'd use in a browser.
Charts, illustrations and Vue components written for the web that draw with SVG work as they are.

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

| Element                                                            | Attributes                                                                                                                                                                              |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `svg`                                                              | `viewBox`, `width`, `height` (they size it; `style` too), `preserveAspectRatio` (`xMidYMid meet`, the default, or `none`)                                                               |
| `path`, `circle`, `ellipse`, `rect`, `line`, `polyline`, `polygon` | their geometry: `d`, `cx`/`cy`/`r`, `x`/`y`/`width`/`height`/`rx`/`ry`, `points`...                                                                                                     |
| `g`                                                                | groups: what it sets is inherited by what's inside                                                                                                                                      |
| `text` (`tspan` inside joins its text)                             | `x`, `y` (the baseline), `dx`, `dy`, `font-size`, `font-weight`, `font-family`, `text-anchor`                                                                                           |
| `defs`, `linearGradient`, `radialGradient`, `stop`                 | gradients, used as `fill="url(#id)"` or `stroke="url(#id)"`: `x1`/`y1`/`x2`/`y2`, `cx`/`cy`/`r`/`fx`/`fy`, `gradientUnits`, `gradientTransform`, `offset`, `stop-color`, `stop-opacity` |

On any element: `fill`, `stroke` (a color, `none`, `currentColor` or `url(#id)`), `stroke-width`,
`stroke-linecap`, `stroke-linejoin`, `stroke-dasharray`, `opacity`, `fill-opacity`, `stroke-opacity`,
`fill-rule` and `transform` (`translate`, `scale`, `rotate`, `skewX`, `skewY`, `matrix`). Like in
SVG, `fill` defaults to black, and `stroke` to none. Percentages are of the `viewBox` (`width="100%"`,
`x="50%"`), and of the shape's box in gradients and stops' `offset`. `width` and `height` on `<svg>`
size it under its `class` and `style`, as on the web.

Not drawn yet: `clipPath`, `mask`, `filter`, `pattern`, `image`, `use`, `foreignObject`, and text on
more than one line.

## Taps

`@press` on an element is called when it's tapped, with where: `{ x, y }`, in points from the view's
corner. It goes on to the `g`s around it and to the `<svg>`'s own `@press`, as a click does on the
web, but not to a `<Pressable>` around the `<svg>`: a tap on an element is the drawing's. A tap where
no element takes it goes to what contains the `<svg>`. Thin elements, like a line, can be tapped
within 44 points of them.

## Icons

[`@nativue/icons`](../../packages/icons/README.md) draws with the same view. Its components pass the
icon's shapes as `elements`, `[tag, attributes]` pairs stroked with `color`:

```vue
<Svg
  :view-box="[0, 0, 24, 24]"
  :elements="[['circle', { cx: 12, cy: 12, r: 10 }]]"
  color="#0e9f84"
/>
```
