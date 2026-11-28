<script setup lang="ts">
import { onMounted, ref, shallowRef, usePermission, type NativeSubscription } from 'vue'
import { Stack } from '@nativue/core/router'
import { Location, type Position } from '@nativue/location'
import Page from '@/components/Page.vue'
import Section from '@/components/Section.vue'

const BUTTON_CLASS =
  'flex-1 items-center rounded-xl bg-white py-3 active:bg-slate-200 dark:bg-slate-800 dark:active:bg-slate-700'
const BUTTON_TEXT_CLASS = 'font-semibold text-slate-900 dark:text-white'
const TEXT_CLASS = 'text-slate-900 dark:text-white'

const { permission, request } = usePermission(Location.getPermission, Location.requestPermission)
const servicesEnabled = ref<boolean | null>(null)
const position = ref('')
const watchedPositions = ref<string[]>([])
const watch = shallowRef<NativeSubscription | null>(null)

onMounted(async () => {
  servicesEnabled.value = await Location.hasServicesEnabled()
})

function describe({ coords, timestamp }: Position) {
  const time = new Date(timestamp).toLocaleTimeString()

  return `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)} ±${Math.round(coords.accuracy)} m at ${time}`
}

async function show(read: () => Promise<Position | null>) {
  position.value = '…'

  try {
    const found = await read()

    position.value = found ? describe(found) : 'None known'
  } catch (failure) {
    const error = failure as Error & { code?: string }

    position.value = `${error.code}: ${error.message}`
  }
}

async function enableServices() {
  servicesEnabled.value = await Location.enableServices()
}

function toggleWatch() {
  if (watch.value) {
    watch.value.remove()
    watch.value = null

    return
  }

  watchedPositions.value = []
  watch.value = Location.watchPosition(
    { accuracy: 'high', distanceInterval: 5 },
    (watched) =>
      (watchedPositions.value = [describe(watched), ...watchedPositions.value].slice(0, 5)),
    (error) => {
      watch.value = null
      watchedPositions.value = [`${error.code}: ${error.message}`]
    },
  )
}
</script>

<template>
  <Page>
    <Stack.Screen :options="{ title: 'Location' }" />

    <Section
      title="Permission"
      :footer="
        permission?.canAskAgain === false ? 'Turn location on for the demo in Settings.' : undefined
      "
    >
      <Text :class="TEXT_CLASS">
        {{
          permission
            ? [permission.status, permission.accuracy, permission.scope].filter(Boolean).join(', ')
            : '…'
        }}
      </Text>
      <View class="flex-row gap-2">
        <Pressable :class="BUTTON_CLASS" @press="request()">
          <Text :class="BUTTON_TEXT_CLASS">While in use</Text>
        </Pressable>
        <Pressable :class="BUTTON_CLASS" @press="request({ background: true })">
          <Text :class="BUTTON_TEXT_CLASS">Always</Text>
        </Pressable>
      </View>
    </Section>

    <Section title="Services" footer="Android asks to turn location on in a dialog.">
      <Text :class="TEXT_CLASS">
        {{
          servicesEnabled === null ? '…' : servicesEnabled ? 'Location is on' : 'Location is off'
        }}
      </Text>
      <View class="flex-row">
        <Pressable :class="BUTTON_CLASS" @press="enableServices">
          <Text :class="BUTTON_TEXT_CLASS">Turn on</Text>
        </Pressable>
      </View>
    </Section>

    <Section title="Position">
      <View class="flex-row gap-2">
        <Pressable
          :class="BUTTON_CLASS"
          @press="show(() => Location.getCurrentPosition({ accuracy: 'high' }))"
        >
          <Text :class="BUTTON_TEXT_CLASS">Current</Text>
        </Pressable>
        <Pressable :class="BUTTON_CLASS" @press="show(Location.getLastKnownPosition)">
          <Text :class="BUTTON_TEXT_CLASS">Last known</Text>
        </Pressable>
      </View>
      <Text v-if="position" :class="TEXT_CLASS">{{ position }}</Text>
    </Section>

    <Section title="Watch" footer="Every 5 meters the device moves.">
      <View class="flex-row">
        <Pressable :class="BUTTON_CLASS" @press="toggleWatch">
          <Text :class="BUTTON_TEXT_CLASS">{{ watch ? 'Stop' : 'Start' }}</Text>
        </Pressable>
      </View>
      <Text v-for="line in watchedPositions" :key="line" :class="TEXT_CLASS">{{ line }}</Text>
    </Section>
  </Page>
</template>
