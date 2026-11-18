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

Give images a size in their style: they don't size themselves to the picture.

## Props

| Prop          | Type                                            | Default   | Description                                                           |
| ------------- | ----------------------------------------------- | --------- | --------------------------------------------------------------------- |
| `source`      | an imported asset, or `{ uri: string }`         |           | the image                                                             |
| `resize-mode` | `'cover' \| 'contain' \| 'stretch' \| 'center'` | `'cover'` | how the image fills its box                                           |
| `alt`         | `string`                                        |           | what it shows, for screen readers; leave it out for decorative images |
| `style`       | `Style`                                         |           | `borderRadius` rounds the image                                       |

- `cover`: fills the box, cropping what overflows
- `contain`: fits inside the box, whole
- `stretch`: fills the box, distorting the image
- `center`: the image at its size, centered
