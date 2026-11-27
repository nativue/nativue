<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Stack } from '@nativue/core/router'
import { ImagePicker, type PickedMedia } from '@nativue/image-picker'
import Page from '@/components/Page.vue'
import Section from '@/components/Section.vue'

const BUTTON_CLASS =
  'flex-1 items-center rounded-xl bg-white py-3 active:bg-slate-200 dark:bg-slate-800 dark:active:bg-slate-700'

const media = ref<PickedMedia[]>([])
const error = ref('')

async function run(choose: () => Promise<PickedMedia[]>) {
  error.value = ''
  try {
    const chosen = await choose()
    if (chosen.length > 0) media.value = chosen
  } catch (failure) {
    error.value = (failure as Error).message
  }
}

const pickOne = () => run(() => ImagePicker.pick())
const pickSeveral = () => run(() => ImagePicker.pick({ limit: 5, mediaTypes: 'all' }))
const takePhoto = () =>
  run(async () => [await ImagePicker.takePhoto()].filter((photo) => photo !== null))

// What came back after Android closed the app while the picker or the camera was open.
onMounted(async () => {
  const pending = await ImagePicker.getPendingResult()
  if (pending) media.value = pending
})
</script>

<template>
  <Page>
    <Stack.Screen :options="{ title: 'Image picker' }" />

    <Section
      title="Photos and videos"
      footer="The system's photo picker, with no permission; the camera asks for its own."
    >
      <View class="flex-row gap-2">
        <Pressable :class="BUTTON_CLASS" @press="pickOne">
          <Text class="font-semibold text-slate-900 dark:text-white">Pick one</Text>
        </Pressable>
        <Pressable :class="BUTTON_CLASS" @press="pickSeveral">
          <Text class="font-semibold text-slate-900 dark:text-white">Up to 5</Text>
        </Pressable>
        <Pressable :class="BUTTON_CLASS" @press="takePhoto">
          <Text class="font-semibold text-slate-900 dark:text-white">Camera</Text>
        </Pressable>
      </View>
      <Text v-if="error" class="text-red-500">{{ error }}</Text>
    </Section>

    <Section v-if="media.length > 0" title="Chosen">
      <View class="flex-row flex-wrap gap-2">
        <View v-for="item in media" :key="item.uri" class="w-[48%] gap-1">
          <Image
            v-if="item.type === 'image'"
            :source="item.uri"
            class="w-full rounded-xl"
            :style="{ aspectRatio: item.width / item.height }"
          />
          <Text class="text-xs text-slate-500 dark:text-slate-400">
            {{ item.type }} {{ item.width }}×{{ item.height }},
            {{ Math.round(item.fileSize / 1024) }} KB
          </Text>
        </View>
      </View>
    </Section>
  </Page>
</template>
