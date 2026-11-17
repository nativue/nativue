<!-- A scrolling screen on the grouped background. Attributes (e.g. :on-scroll) go to the ScrollView. -->
<script setup lang="ts">
import { StyleSheet } from 'vue'
import { colors, spacing } from '../theme'

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.large, paddingBottom: 48, gap: spacing.large },
})
</script>

<template>
  <ScrollView
    :style="styles.scroll"
    content-inset-adjustment-behavior="automatic"
    keyboard-dismiss-mode="on-drag"
  >
    <View :style="styles.content">
      <slot />
    </View>
  </ScrollView>
</template>
