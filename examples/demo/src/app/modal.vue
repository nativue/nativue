<script setup lang="ts">
import { StyleSheet } from 'vue'
import { Stack, useRouter } from '@nativue/core/router'
import { AppWindowIcon } from '@nativue/icons/lucide'
import IconTile from '@/components/IconTile.vue'
import Page from '@/components/Page.vue'
import PrimaryButton from '@/components/PrimaryButton.vue'
import { colors } from '@/lib/theme'

const router = useRouter()

const screenOptions = { headerRight: [{ title: 'Close', onPress: () => router.back() }] }

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 16, paddingVertical: 24 },
  title: { fontSize: 28, fontWeight: '800', color: colors.text, textAlign: 'center' },
  body: { fontSize: 17, color: colors.secondaryText, textAlign: 'center' },
})
</script>

<template>
  <Page>
    <Stack.Screen :options="screenOptions" />

    <View :style="styles.hero">
      <IconTile :icon="AppWindowIcon" :tint="colors.ink" :size="72" />
      <Text :style="styles.title">A modal route</Text>
      <Text :style="styles.body">
        It lives at src/app/modal.vue. Swipe down, tap Close or use the button to dismiss it.
      </Text>
    </View>

    <PrimaryButton title="Dismiss" @press="router.back()" />
  </Page>
</template>
