<!-- A label on the left and a control (the slot) on the right. -->
<script setup lang="ts">
import { StyleSheet } from 'vue'
import { colors } from '../theme'

defineProps<{ label: string; detail?: string }>()

const styles = StyleSheet.create({
  row: {
    minHeight: 32,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  texts: { flexShrink: 1, gap: 2 },
  label: { fontSize: 17, color: colors.text },
  detail: { fontSize: 13, color: colors.secondaryText },
})
</script>

<template>
  <View :style="styles.row">
    <View :style="styles.texts">
      <Text :style="styles.label">{{ label }}</Text>
      <Text v-if="detail" :style="styles.detail">{{ detail }}</Text>
    </View>
    <slot />
  </View>
</template>
