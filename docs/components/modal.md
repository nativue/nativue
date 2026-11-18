# Modal

Shows content over the screen: full screen, or as a sheet that slides up (a native sheet on iOS, a
Material bottom sheet on Android). A ref drives it:

```vue
<script setup lang="ts">
import { ref } from 'vue'

const sheetVisible = ref(false)
</script>

<template>
  <Button title="Show details" @press="sheetVisible = true" />

  <Modal
    :visible="sheetVisible"
    animation-type="slide"
    presentation-style="pageSheet"
    @request-close="sheetVisible = false"
  >
    <View :style="{ flex: 1, padding: 24 }">
      <Text>Details</Text>
      <Button title="Done" @press="sheetVisible = false" />
    </View>
  </Modal>
</template>
```

For a modal that is a screen of its own, with a header and a route, use
[`presentation: 'modal'`](../navigation.md#modals-and-sheets) instead.

## Props

| Prop                 | Type                                                             | Default        | Description                                                                                                        |
| -------------------- | ---------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------ |
| `visible`            | `boolean`                                                        | `false`        | shows or hides it                                                                                                  |
| `animation-type`     | `'none' \| 'slide' \| 'fade'`                                    | `'none'`       | how it appears                                                                                                     |
| `presentation-style` | `'fullScreen' \| 'pageSheet' \| 'formSheet' \| 'overFullScreen'` | `'fullScreen'` | `pageSheet` and `formSheet` are sheets; `overFullScreen` keeps the screen below visible through transparent parts  |
| `transparent`        | `boolean`                                                        | `false`        | no background of its own, shown over the screen (as `overFullScreen`): for dialogs over a dimmed backdrop you draw |

## Events

| Event            | Fires                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| `@request-close` | when the user dismisses it: a sheet swiped down, or Android's back button. Set `visible` to `false` here |
| `@show`          | once it's on screen                                                                                      |
| `@dismiss`       | once it's gone                                                                                           |
