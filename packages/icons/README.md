# @nativue/icons

Icon sets for [nativue](https://github.com/nativue/nativue) apps, drawn by the native `<Svg>`.
Only the icons you import end up in the bundle.

```vue
<script setup lang="ts">
import { HeartIcon } from '@nativue/icons/lucide'
</script>

<template>
  <HeartIcon :size="24" color="#ff3b30" :stroke-width="2" />
</template>
```

They also work as tab and header icons: `tabBarIcon: HeartIcon`, or
`headerRight: [{ title: 'Like', icon: HeartIcon, onPress }]`.
