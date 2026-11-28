<script setup lang="ts">
import { ref } from 'vue'
import { Stack } from '@nativue/core/router'
import { ImagePicker } from '@nativue/image-picker'
import { Share, type ShareContent } from '@nativue/share'
import Page from '@/components/Page.vue'
import Section from '@/components/Section.vue'

const BUTTON_CLASS =
  'flex-1 items-center rounded-xl bg-white py-3 active:bg-slate-200 dark:bg-slate-800 dark:active:bg-slate-700'

const status = ref('')

async function share(content: () => Promise<ShareContent | null>) {
  try {
    const shared = await content()

    if (!shared) return

    const { completed, app } = await Share.share(shared)

    status.value = completed ? `Shared with ${app}` : 'Closed without sharing'
  } catch (failure) {
    const error = failure as Error & { code?: string }

    status.value = `${error.code ?? 'Error'}: ${error.message}`
  }
}

const shareLink = () =>
  share(async () => ({
    text: 'Vue, but truly native.',
    url: 'https://github.com/nativue/nativue',
    subject: 'Have a look at nativue',
  }))

// Photos and videos from the library: the picker saves them in the app's cache, which can be shared.
const shareMedia = () =>
  share(async () => {
    const media = await ImagePicker.pick({ limit: 3, mediaTypes: 'all' })

    return media.length > 0 ? { files: media.map(({ uri }) => uri) } : null
  })
</script>

<template>
  <Page>
    <Stack.Screen :options="{ title: 'Share' }" />

    <Section title="Share" footer="The system's share sheet, to any app that takes what's shared.">
      <View class="flex-row gap-2">
        <Pressable :class="BUTTON_CLASS" @press="shareLink">
          <Text class="font-semibold text-slate-900 dark:text-white">A link</Text>
        </Pressable>
        <Pressable :class="BUTTON_CLASS" @press="shareMedia">
          <Text class="font-semibold text-slate-900 dark:text-white">Photos</Text>
        </Pressable>
      </View>
      <Text v-if="status" class="text-slate-500 dark:text-slate-400">{{ status }}</Text>
    </Section>
  </Page>
</template>
