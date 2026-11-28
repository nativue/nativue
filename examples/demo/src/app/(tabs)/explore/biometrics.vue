<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Stack } from '@nativue/core/router'
import { Biometrics, type BiometricStatus } from '@nativue/biometrics'
import Page from '@/components/Page.vue'
import Section from '@/components/Section.vue'

const BUTTON_CLASS =
  'flex-1 items-center rounded-xl bg-white py-3 active:bg-slate-200 dark:bg-slate-800 dark:active:bg-slate-700'

const deviceStatus = ref<BiometricStatus | null>(null)
const result = ref('')

async function authenticate(allowDeviceCredential: boolean) {
  try {
    const answer = await Biometrics.authenticate({
      reason: 'Unlock the demo’s secrets',
      title: 'It’s you?',
      allowDeviceCredential,
    })

    result.value = answer.success ? 'Unlocked' : `Not unlocked: ${answer.error}`
  } catch (failure) {
    result.value = (failure as Error).message
  }
}

onMounted(async () => {
  deviceStatus.value = await Biometrics.getStatus()
})
</script>

<template>
  <Page>
    <Stack.Screen :options="{ title: 'Biometrics' }" />

    <Section title="This device">
      <Text v-if="deviceStatus" class="text-slate-900 dark:text-white">
        {{ deviceStatus.available ? 'Available' : 'Not available' }},
        {{ deviceStatus.enrolled ? 'set up' : 'not set up' }}
        ({{ deviceStatus.types.join(', ') || 'no sensors' }})
      </Text>
    </Section>

    <Section
      title="Unlock"
      footer="Face ID, Touch ID or a fingerprint; the passcode only if allowed."
    >
      <View class="flex-row gap-2">
        <Pressable :class="BUTTON_CLASS" @press="authenticate(false)">
          <Text class="font-semibold text-slate-900 dark:text-white">Biometrics</Text>
        </Pressable>
        <Pressable :class="BUTTON_CLASS" @press="authenticate(true)">
          <Text class="font-semibold text-slate-900 dark:text-white">Or passcode</Text>
        </Pressable>
      </View>
      <Text v-if="result" class="text-slate-500 dark:text-slate-400">{{ result }}</Text>
    </Section>
  </Page>
</template>
