<script setup lang="ts">
import { onMounted, ref, usePermission } from 'vue'
import { Stack } from '@nativue/core/router'
import { Notifications } from '@nativue/notifications'
import Page from '@/components/Page.vue'
import Section from '@/components/Section.vue'

const { permission, request } = usePermission(
  Notifications.getPermission,
  Notifications.requestPermission,
)
const lastTap = ref('')

function showTap(data: unknown) {
  lastTap.value = JSON.stringify(data ?? {})
}

Notifications.onResponse(({ notification }) => showTap(notification.data))

onMounted(async () => {
  const response = await Notifications.getLastResponse()

  if (response) showTap(response.notification.data)
})

async function notify(seconds: number | null) {
  const { granted } = permission.value?.granted ? permission.value : await request()

  if (!granted) return

  const trigger = seconds === null ? null : { seconds }

  await Notifications.schedule(
    { title: 'nativue', body: 'Tap to open the demo', data: { seconds } },
    trigger,
  )
}
</script>

<template>
  <Page>
    <Stack.Screen :options="{ title: 'Notifications' }" />

    <Section
      title="Permission"
      :footer="permission?.canAskAgain === false ? 'Turn notifications on in Settings.' : undefined"
    >
      <Text class="text-slate-900 dark:text-white">{{ permission?.status ?? '…' }}</Text>
      <Pressable
        v-if="permission?.canAskAgain === false"
        class="items-center rounded-xl bg-white py-3 active:bg-slate-200 dark:bg-slate-800 dark:active:bg-slate-700"
        @press="Notifications.openSettings()"
      >
        <Text class="font-semibold text-slate-900 dark:text-white">Open Settings</Text>
      </Pressable>
    </Section>

    <Section
      title="Send"
      footer="In 5 seconds: go to the home screen to see it arrive, then tap it."
    >
      <Pressable
        class="items-center rounded-xl bg-white py-3 active:bg-slate-200 dark:bg-slate-800 dark:active:bg-slate-700"
        @press="notify(null)"
      >
        <Text class="font-semibold text-slate-900 dark:text-white">Now</Text>
      </Pressable>
      <Pressable
        class="items-center rounded-xl bg-white py-3 active:bg-slate-200 dark:bg-slate-800 dark:active:bg-slate-700"
        @press="notify(5)"
      >
        <Text class="font-semibold text-slate-900 dark:text-white">In 5 seconds</Text>
      </Pressable>
      <Text v-if="lastTap" class="text-slate-500">Opened from a notification: {{ lastTap }}</Text>
    </Section>
  </Page>
</template>
