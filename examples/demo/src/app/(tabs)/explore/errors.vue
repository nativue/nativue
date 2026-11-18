<!-- Each button breaks the app on purpose, to show the error screen of development builds. -->
<script setup lang="ts">
import { computed, ref, StyleSheet } from 'vue'
import { Stack } from '@nativue/core/router'
import Page from '@/components/Page.vue'
import PrimaryButton from '@/components/PrimaryButton.vue'
import Section from '@/components/Section.vue'
import { colors } from '@/lib/theme'

interface Profile {
  name: string
}

const profile = ref<Profile | null>({ name: 'Ada' })

const styles = computed(() =>
  StyleSheet.create({
    text: { fontSize: 15, color: colors.secondaryText },
    greeting: { fontSize: 17, fontWeight: '600', color: colors.text },
  }),
)

function throwInHandler() {
  throw new Error('Something went wrong in a press handler')
}

function throwInTimer() {
  setTimeout(() => {
    throw new Error('Something went wrong in a timer')
  }, 300)
}

// The template reads profile.name, so the next render fails.
function breakRender() {
  profile.value = null
}
</script>

<template>
  <Page>
    <Stack.Screen :options="{ title: 'Errors' }" />

    <Section
      title="Error screen"
      footer="Development builds only: release builds just log the error. Saving a file reloads the app and closes the screen."
    >
      <Text :style="styles.text">
        An uncaught error shows the message, the components it happened in and the stack. Try one:
      </Text>
      <PrimaryButton title="Throw in a press handler" :tint="colors.red" @press="throwInHandler" />
      <PrimaryButton title="Throw in a timer" :tint="colors.orange" @press="throwInTimer" />
    </Section>

    <Section title="Render" footer="After this one, tap Reload to bring the screen back.">
      <Text :style="styles.greeting">Hello, {{ profile!.name }}</Text>
      <PrimaryButton title="Break the render" :tint="colors.purple" @press="breakRender" />
    </Section>
  </Page>
</template>
