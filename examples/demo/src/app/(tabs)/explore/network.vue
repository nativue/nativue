<script setup lang="ts">
import { computed, ref } from 'vue'
import { Stack } from '@nativue/core/router'
import { Network, useNetworkState, type NetworkState } from '@nativue/network'
import Page from '@/components/Page.vue'
import Section from '@/components/Section.vue'

const TYPE_NAMES: Record<NetworkState['type'], string> = {
  wifi: 'Wi-Fi',
  cellular: 'Cellular',
  ethernet: 'Ethernet',
  other: 'Other',
  none: 'None',
}

const network = useNetworkState()
const changes = ref<{ id: number; text: string }[]>([])
let nextChangeId = 0

const rows = computed(() => {
  const state = network.value

  if (!state) return []

  return [
    ['Status', state.isConnected ? 'Online' : 'Offline'],
    ['Connection', TYPE_NAMES[state.type]],
    ['Reaches the internet', state.isInternetReachable ? 'Yes' : 'No'],
    ['Metered', state.isExpensive ? 'Yes' : 'No'],
  ]
})

Network.addListener((state) => {
  const time = new Date().toLocaleTimeString()

  const text = `${time}: ${TYPE_NAMES[state.type]}${state.isInternetReachable ? '' : ', no internet'}`

  changes.value = [{ id: nextChangeId++, text }, ...changes.value].slice(0, 5)
})
</script>

<template>
  <Page>
    <Stack.Screen :options="{ title: 'Network' }" />

    <Section title="Now" footer="Live: turn Wi-Fi or airplane mode on and off.">
      <View v-for="[label, value] in rows" :key="label" class="flex-row justify-between py-1">
        <Text class="text-slate-500 dark:text-slate-400">{{ label }}</Text>
        <Text class="font-semibold text-slate-900 dark:text-white">{{ value }}</Text>
      </View>
    </Section>

    <Section v-if="changes.length > 0" title="Changes">
      <Text v-for="change in changes" :key="change.id" class="text-slate-900 dark:text-white">
        {{ change.text }}
      </Text>
    </Section>
  </Page>
</template>
