<script setup lang="ts">
import { ref, watch } from 'vue'
import { Stack } from '@nativue/core/router'
import { Clipboard } from '@nativue/clipboard'
import Page from '@/components/Page.vue'
import Section from '@/components/Section.vue'

const text = ref('Hello from nativue')
const status = ref('')

watch(text, () => (status.value = ''))

async function copy() {
  const { copied, systemConfirmed } = await Clipboard.copy(text.value)

  if (!copied) status.value = "Couldn't copy"
  else status.value = systemConfirmed ? '' : 'Copied'
}
</script>

<template>
  <Page>
    <Stack.Screen :options="{ title: 'Clipboard' }" />

    <Section
      title="Copy"
      footer="Android 13 and later confirm a copy on their own; elsewhere the app shows that it copied."
    >
      <TextInput
        v-model="text"
        class="rounded-xl bg-white px-4 py-3 text-slate-900 dark:bg-slate-800 dark:text-white"
      />
      <Pressable
        class="items-center rounded-xl bg-white py-3 active:bg-slate-200 dark:bg-slate-800 dark:active:bg-slate-700"
        @press="copy"
      >
        <Text class="font-semibold text-slate-900 dark:text-white">Copy</Text>
      </Pressable>
      <Text v-if="status" class="text-slate-500">{{ status }}</Text>
    </Section>
  </Page>
</template>
