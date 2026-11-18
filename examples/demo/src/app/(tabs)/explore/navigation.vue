<script setup lang="ts">
import { ref, StyleSheet } from 'vue'
import { Stack, useFocusEffect, useRouter } from '@nativue/core/router'
import Page from '@/components/Page.vue'
import PrimaryButton from '@/components/PrimaryButton.vue'
import Section from '@/components/Section.vue'
import { colors } from '@/lib/theme'

const router = useRouter()
const focusCount = ref(0)

// Runs every time this screen comes back on top: after a pop, a modal, a tab switch.
useFocusEffect(() => {
  focusCount.value++
})

const styles = StyleSheet.create({
  counter: { fontSize: 48, fontWeight: '800', color: colors.green, textAlign: 'center' },
  code: { fontSize: 15, fontWeight: '600', color: colors.ink },
})
</script>

<template>
  <Page>
    <Stack.Screen :options="{ title: 'Navigation' }" />

    <Section title="Stack" footer="Screens are pushed on the platform's native navigation stack.">
      <PrimaryButton title="Push a screen" @press="router.push('/explore/navigation/1')" />
    </Section>

    <Section title="Modal" footer="A route with presentation: 'modal' in the root layout.">
      <PrimaryButton
        title="Open the modal route"
        :tint="colors.ink"
        @press="router.push('/modal')"
      />
    </Section>

    <Section title="Deep links" footer="The same path works as a URL from anywhere on the device.">
      <Text :style="styles.code">nativue://explore/gestures</Text>
      <Button title="Navigate to it" @press="router.navigate('/explore/gestures')" />
    </Section>

    <Section
      title="Focus"
      footer="Counted with useFocusEffect: push, pop or switch tabs to bump it."
    >
      <Text :style="styles.counter">{{ focusCount }}</Text>
    </Section>

    <Section title="Tabs">
      <Button title="Switch to the Welcome tab" @press="router.navigate('/')" />
    </Section>
  </Page>
</template>
