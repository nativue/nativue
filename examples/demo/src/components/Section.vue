<!-- A titled white card, like an inset grouped table section. `flush` drops the padding for rows. -->
<script setup lang="ts">
import { computed, StyleSheet } from 'vue'
import { colors, radius, spacing } from '@/lib/theme'

defineProps<{ title?: string; footer?: string; flush?: boolean }>()

const styles = computed(() =>
  StyleSheet.create({
    section: { gap: spacing.small },
    title: {
      paddingHorizontal: spacing.medium,
      fontSize: 13,
      fontWeight: '600',
      color: colors.secondaryText,
    },
    card: {
      padding: spacing.medium,
      gap: spacing.medium,
      borderRadius: radius.medium,
      backgroundColor: colors.surface,
    },
    flushCard: { padding: 0, gap: 0, overflow: 'hidden' },
    footer: { paddingHorizontal: spacing.medium, fontSize: 13, color: colors.secondaryText },
  }),
)
</script>

<template>
  <View :style="styles.section">
    <Text v-if="title" role="heading" :aria-label="title" :style="styles.title">
      {{ title.toUpperCase() }}
    </Text>
    <View :style="flush ? { ...styles.card, ...styles.flushCard } : styles.card">
      <slot />
    </View>
    <Text v-if="footer" :style="styles.footer">{{ footer }}</Text>
  </View>
</template>
