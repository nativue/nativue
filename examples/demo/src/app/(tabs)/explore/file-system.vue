<script setup lang="ts">
import { ref } from 'vue'
import { Stack } from '@nativue/core/router'
import { FileSystem, Paths, type TransferProgress } from '@nativue/file-system'
import Page from '@/components/Page.vue'
import Section from '@/components/Section.vue'

const BUTTON_CLASS =
  'flex-1 items-center rounded-xl bg-white py-3 active:bg-slate-200 dark:bg-slate-800 dark:active:bg-slate-700'
const NOTE = `${Paths.document}notes/note.txt`
const PHOTO = `${Paths.cache}photo.jpg`
const PHOTO_URL = 'https://picsum.photos/id/1018/3000/2000'
const UPLOAD_URL = 'https://httpbin.org/post'

const note = ref('Hello from nativue')
const noteStatus = ref('')
const transferStatus = ref('')
const photoUri = ref<string | null>(null)
let running: { cancel(): void } | null = null

async function attempt(action: () => Promise<void>, status = noteStatus) {
  try {
    await action()
  } catch (failure) {
    const error = failure as Error & { code?: string }

    status.value = `${error.code ?? 'Error'}: ${error.message}`
  }
}

const saveNote = () =>
  attempt(async () => {
    await FileSystem.writeText(NOTE, note.value)
    await describeNote()
  })

const appendLine = () =>
  attempt(async () => {
    await FileSystem.writeText(NOTE, `\nSaved at ${new Date().toLocaleTimeString()}`, {
      append: true,
    })
    await describeNote()
  })

const readNote = () =>
  attempt(async () => {
    noteStatus.value = await FileSystem.readText(NOTE)
  })

const deleteNote = () =>
  attempt(async () => {
    await FileSystem.delete(NOTE)
    await describeNote()
  })

async function describeNote() {
  const info = await FileSystem.getInfo(NOTE)

  noteStatus.value = info.exists
    ? `${info.size} bytes, saved ${new Date(info.modificationTime).toLocaleTimeString()}`
    : 'No note'
}

function describeProgress({ bytes, totalBytes }: TransferProgress) {
  const kilobytes = Math.round(bytes / 1024)

  transferStatus.value =
    totalBytes === null ? `${kilobytes} KB` : `${kilobytes} of ${Math.round(totalBytes / 1024)} KB`
}

const download = () =>
  attempt(async () => {
    photoUri.value = null

    const transfer = FileSystem.download(PHOTO_URL, PHOTO, { onProgress: describeProgress })

    running = transfer

    const result = await transfer
    const info = await FileSystem.getInfo(result.uri)

    transferStatus.value = `${result.status}: ${Math.round(info.size / 1024)} KB saved`
    photoUri.value = result.uri
  }, transferStatus)

const upload = () =>
  attempt(async () => {
    const transfer = FileSystem.upload(UPLOAD_URL, PHOTO, {
      multipart: { field: 'photo', mimeType: 'image/jpeg', fields: { caption: 'From nativue' } },
      onProgress: describeProgress,
    })

    running = transfer

    const result = await transfer
    const echo = JSON.parse(result.body) as { form?: { caption?: string }; files?: object }

    transferStatus.value = `${result.status}: the server got caption "${echo.form?.caption}" and ${Object.keys(echo.files ?? {}).join(', ')}`
  }, transferStatus)

function cancel() {
  running?.cancel()
}
</script>

<template>
  <Page>
    <Stack.Screen :options="{ title: 'File system' }" />

    <Section title="A note" :footer="`Saved in ${NOTE}`">
      <TextInput
        v-model="note"
        class="rounded-xl bg-white px-4 py-3 text-slate-900 dark:bg-slate-800 dark:text-white"
      />
      <View class="flex-row gap-2">
        <Pressable :class="BUTTON_CLASS" @press="saveNote">
          <Text class="font-semibold text-slate-900 dark:text-white">Save</Text>
        </Pressable>
        <Pressable :class="BUTTON_CLASS" @press="appendLine">
          <Text class="font-semibold text-slate-900 dark:text-white">Append</Text>
        </Pressable>
        <Pressable :class="BUTTON_CLASS" @press="readNote">
          <Text class="font-semibold text-slate-900 dark:text-white">Read</Text>
        </Pressable>
        <Pressable :class="BUTTON_CLASS" @press="deleteNote">
          <Text class="font-semibold text-slate-900 dark:text-white">Delete</Text>
        </Pressable>
      </View>
      <Text v-if="noteStatus" class="text-slate-500 dark:text-slate-400">{{ noteStatus }}</Text>
    </Section>

    <Section title="Download and upload" footer="A 3000×2000 photo, then sent back as a form.">
      <View class="flex-row gap-2">
        <Pressable :class="BUTTON_CLASS" @press="download">
          <Text class="font-semibold text-slate-900 dark:text-white">Download</Text>
        </Pressable>
        <Pressable :class="BUTTON_CLASS" @press="upload">
          <Text class="font-semibold text-slate-900 dark:text-white">Upload</Text>
        </Pressable>
        <Pressable :class="BUTTON_CLASS" @press="cancel">
          <Text class="font-semibold text-slate-900 dark:text-white">Cancel</Text>
        </Pressable>
      </View>
      <Text v-if="transferStatus" class="text-slate-500 dark:text-slate-400">
        {{ transferStatus }}
      </Text>
      <Image
        v-if="photoUri"
        :source="photoUri"
        cache="none"
        class="w-full rounded-xl"
        :style="{ aspectRatio: 3 / 2 }"
      />
    </Section>
  </Page>
</template>
