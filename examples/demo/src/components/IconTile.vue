<!-- A white icon on a rounded colored square, like Settings app icons. -->
<script setup lang="ts">
import { StyleSheet, type Component } from 'vue'

const props = withDefaults(defineProps<{ icon: Component; tint: string; size?: number }>(), {
  size: 36,
})

const styles = StyleSheet.create({
  tile: { justifyContent: 'center', alignItems: 'center' },
})
</script>

<template>
  <View
    :style="{
      ...styles.tile,
      width: props.size,
      height: props.size,
      borderRadius: props.size * 0.26,
      backgroundColor: props.tint,
    }"
  >
    <component :is="props.icon" :size="props.size * 0.56" color="#ffffff" />
  </View>
</template>
