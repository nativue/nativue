# ImageBackground

An [`Image`](image.md) behind other content: text over a photo, a header with a cover.

```vue
<ImageBackground
  :source="{ uri: cover }"
  alt="The trail at sunrise"
  :style="{ height: 200, justifyContent: 'flex-end', padding: 16 }"
>
  <Text :style="{ color: 'white', fontSize: 28, fontWeight: '700' }">Weekend hike</Text>
</ImageBackground>
```

The image fills the box, and the children lay out over it as in a [`View`](view.md). The box doesn't
take the image's size: give it one with `style`.

## Props

The same as [`Image`](image.md#props), plus `style` for the box:

| Prop          | Type                                            | Default   | Description                                                                    |
| ------------- | ----------------------------------------------- | --------- | ------------------------------------------------------------------------------ |
| `source`      | an imported asset, or `{ uri: string }`         |           | the image                                                                      |
| `resize-mode` | `'cover' \| 'contain' \| 'stretch' \| 'center'` | `'cover'` | how the image fills the box                                                    |
| `cache`       | `'disk' \| 'memory' \| 'none'`                  | `'disk'`  | where downloads are kept: see [Caching](image.md#caching)                      |
| `alt`         | `string`                                        |           | what the image shows, for screen readers; leave it out if it's decorative      |
| `style`       | `Style`                                         |           | the box's style; `borderRadius` with `overflow: 'hidden'` rounds the image too |

Other attributes (`role`, `aria-*`, `@layout`...) go to the box.
