<!-- The main call to action of a screen. -->
<script setup lang="ts">
import { StyleSheet } from 'vue'
import { colors, radius } from '../theme'

withDefaults(defineProps<{ title: string; tint?: string }>(), { tint: colors.green })

const emit = defineEmits<{ press: [] }>()

const styles = StyleSheet.create({
  button: {
    height: 54,
    paddingHorizontal: 24,
    borderRadius: radius.medium,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  title: { color: '#ffffff', fontSize: 17, fontWeight: '600' },
})
</script>

<template>
  <Pressable
    :style="{ ...styles.button, backgroundColor: tint }"
    :pressed-style="styles.pressed"
    @press="emit('press')"
  >
    <Text :style="styles.title">{{ title }}</Text>
  </Pressable>
</template>
