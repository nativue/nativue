<!-- A row of the Explore catalog: opens its demo. -->
<script setup lang="ts">
import { StyleSheet } from 'vue'
import { ChevronRightIcon } from 'vuenative-icons/lucide'
import { Link } from 'vuenative/router'
import type { Demo } from '@/lib/demos'
import { colors, spacing } from '@/lib/theme'
import IconTile from './IconTile.vue'

defineProps<{ demo: Demo }>()

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: spacing.medium,
    paddingVertical: 12,
  },
  pressed: { backgroundColor: colors.pressed },
  texts: { flex: 1, gap: 2 },
  title: { fontSize: 17, fontWeight: '600', color: colors.text },
  subtitle: { fontSize: 14, color: colors.secondaryText },
})
</script>

<template>
  <Link :href="demo.href" :style="styles.row" :pressed-style="styles.pressed">
    <IconTile :icon="demo.icon" :tint="demo.tint" />
    <View :style="styles.texts">
      <Text :style="styles.title">{{ demo.title }}</Text>
      <Text :style="styles.subtitle">{{ demo.subtitle }}</Text>
    </View>
    <ChevronRightIcon :size="20" :color="colors.tertiaryText" />
  </Link>
</template>
