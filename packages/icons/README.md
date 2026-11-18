# @nativue/icons

Icon sets for [nativue](https://github.com/nativue/nativue) apps, drawn natively: 2,000+ icons from
[Lucide](https://lucide.dev). Only the icons you import end up in the bundle.

```sh
npm install @nativue/icons
```

```vue
<script setup lang="ts">
import { HeartIcon } from '@nativue/icons/lucide'
</script>

<template>
  <HeartIcon :size="24" color="#ff3b30" :stroke-width="2" />
</template>
```

Each icon is named after Lucide's, in PascalCase with `Icon` at the end: `arrow-left` is
`ArrowLeftIcon`. Browse them at [lucide.dev/icons](https://lucide.dev/icons).

## Props

| Prop                    | Type      | Default     | Description                                          |
| ----------------------- | --------- | ----------- | ---------------------------------------------------- |
| `size`                  | `number`  | `24`        | width and height, in points                          |
| `color`                 | `string`  | `'#000000'` | the stroke color                                     |
| `stroke-width`          | `number`  | `2`         | in the icon's 24-unit grid, so it scales with `size` |
| `absolute-stroke-width` | `boolean` | `false`     | keeps `stroke-width` in points, whatever the `size`  |
| `style`                 | `Style`   |             | layout and margins                                   |

## Tab and header icons

Icons work on tab bars and header buttons, on both platforms:

```vue
<Tabs.Screen name="index" :options="{ title: 'Home', tabBarIcon: HouseIcon }" />
```

```ts
const options = { headerRight: [{ title: 'Like', icon: HeartIcon, onPress: like }] }
```

See [Navigation](https://github.com/nativue/nativue/blob/main/docs/navigation.md).
