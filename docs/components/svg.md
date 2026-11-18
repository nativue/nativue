# Svg

Draws vector shapes natively. It's the low level piece behind
[`@nativue/icons`](../../packages/icons/README.md): for icons, use those components instead.

```vue
<Svg
  :view-box="[0, 0, 24, 24]"
  :elements="[
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['path', { d: 'M8 12h8' }],
  ]"
  color="#0e9f84"
  :stroke-width="2"
  :style="{ width: 24, height: 24 }"
/>
```

## Props

| Prop           | Type                    | Default  | Description                                                                                                  |
| -------------- | ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `elements`     | `[tag, attributes][]`   | required | the shapes: `path`, `circle`, `ellipse`, `rect`, `line`, `polyline` and `polygon`, with their SVG attributes |
| `view-box`     | `[x, y, width, height]` |          | the drawing's coordinate space, scaled to the view's size                                                    |
| `color`        | `string`                |          | the stroke color; shapes are filled with it too unless `fill` is `'none'`                                    |
| `stroke-width` | `number`                |          | in the `view-box`'s units                                                                                    |
| `style`        | `Style`                 |          | give it a size                                                                                               |

Shapes use one color: no gradients or per-shape colors.
