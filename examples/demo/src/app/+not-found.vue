<script setup lang="ts">
import { computed, StyleSheet } from 'vue'
import { Link, Stack, usePathname } from '@nativue/core/router'
import Page from '@/components/Page.vue'
import { colors } from '@/lib/theme'

const pathname = usePathname()

const styles = computed(() =>
  StyleSheet.create({
    title: { fontSize: 28, fontWeight: '800', color: colors.text },
    body: { fontSize: 17, color: colors.secondaryText },
    link: { fontSize: 17, fontWeight: '600', color: colors.green },
  }),
)
</script>

<template>
  <Page>
    <Stack.Screen :options="{ title: 'Not found' }" />
    <Text :style="styles.title">Nothing at {{ pathname }}</Text>
    <Text :style="styles.body">This screen doesn't exist.</Text>
    <Link href="/">
      <Text :style="styles.link">Go to the start ›</Text>
    </Link>
  </Page>
</template>
