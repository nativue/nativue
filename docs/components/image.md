# Image

Shows an image from the app's assets or from the network.

```vue
<script setup lang="ts">
import logo from '@/assets/logo.png'
</script>

<template>
  <Image :source="logo" resize-mode="contain" :style="{ width: 96, height: 96 }" />
  <Image :source="{ uri: 'https://example.com/photo.jpg' }" :style="{ height: 200 }" />
</template>
```

Like an `<img>` on the web, an image without a `width` or `height` takes the picture's size, a pixel
per point; given one of them, the other follows the picture's aspect ratio. In a column, an image
stretches to the column's width, so its height follows. Until the picture loads, it has no size: give
a fixed size to images that shouldn't move things around as they appear, like a list's.

## Caching

By default, downloaded images are kept on disk and in memory: one that comes back on screen, like a list
row's, shows at once, and after a relaunch it shows without downloading again. `cache` changes that:

- `disk` (the default): on disk and in memory
- `memory`: in memory only, gone when the app closes
- `none`: not kept; it downloads every time it's shown

```vue
<Image :source="{ uri: avatarUrl }" cache="memory" :style="{ width: 40, height: 40 }" />
```

The disk cache lives in the system's cache folder, up to 100 MB: past that, the images used least
recently go first, and the system may empty the folder when the device runs low on space. Images are
kept by URL, without checking the server again: to update one, change its URL, for example with
`?v=2`.

## Props

| Prop          | Type                                            | Default   | Description                                                           |
| ------------- | ----------------------------------------------- | --------- | --------------------------------------------------------------------- |
| `source`      | an imported asset, or `{ uri: string }`         |           | the image                                                             |
| `resize-mode` | `'cover' \| 'contain' \| 'stretch' \| 'center'` | `'cover'` | how the image fills its box                                           |
| `cache`       | `'disk' \| 'memory' \| 'none'`                  | `'disk'`  | where downloads are kept: see [Caching](#caching)                     |
| `alt`         | `string`                                        |           | what it shows, for screen readers; leave it out for decorative images |
| `style`       | `Style`                                         |           | `borderRadius` rounds the image                                       |

- `cover`: fills the box, cropping what overflows
- `contain`: fits inside the box, whole
- `stretch`: fills the box, distorting the image
- `center`: the image at its size, centered
