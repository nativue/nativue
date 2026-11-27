<script setup lang="ts">
import { ref } from 'vue'
import { Stack } from '@nativue/core/router'
import { SecureStore } from '@nativue/secure-store'
import Page from '@/components/Page.vue'
import Section from '@/components/Section.vue'

const KEY = 'demo-token'
const BUTTON_CLASS =
  'flex-1 items-center rounded-xl bg-white py-3 active:bg-slate-200 dark:bg-slate-800 dark:active:bg-slate-700'

const token = ref('s3cr3t-t0ken')
const stored = ref<string | null>(null)
const hasRead = ref(false)

async function save() {
  await SecureStore.setItem(KEY, token.value)
  await read()
}

async function read() {
  stored.value = await SecureStore.getItem(KEY)
  hasRead.value = true
}

async function remove() {
  await SecureStore.deleteItem(KEY)
  await read()
}
</script>

<template>
  <Page>
    <Stack.Screen :options="{ title: 'Secure store' }" />

    <Section
      title="A secret"
      footer="Kept in the Keychain on iOS and encrypted by the Android Keystore on Android: it stays after the app restarts."
    >
      <TextInput
        v-model="token"
        class="rounded-xl bg-white px-4 py-3 text-slate-900 dark:bg-slate-800 dark:text-white"
      />
      <View class="flex-row gap-2">
        <Pressable :class="BUTTON_CLASS" @press="save">
          <Text class="font-semibold text-slate-900 dark:text-white">Save</Text>
        </Pressable>
        <Pressable :class="BUTTON_CLASS" @press="read">
          <Text class="font-semibold text-slate-900 dark:text-white">Read</Text>
        </Pressable>
        <Pressable :class="BUTTON_CLASS" @press="remove">
          <Text class="font-semibold text-slate-900 dark:text-white">Delete</Text>
        </Pressable>
      </View>
      <Text v-if="hasRead" class="text-slate-500 dark:text-slate-400">
        {{ stored === null ? 'Nothing stored' : `Stored: ${stored}` }}
      </Text>
    </Section>
  </Page>
</template>
