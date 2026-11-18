<script setup lang="ts">
import { Stack } from '@nativue/core/router'
import { Haptics, type ImpactStyle, type NotificationType } from '@nativue/haptics'
import Page from '@/components/Page.vue'
import Section from '@/components/Section.vue'

const IMPACT_STYLES: ImpactStyle[] = ['light', 'medium', 'heavy']
const NOTIFICATION_TYPES: NotificationType[] = ['success', 'warning', 'error']
const BUTTON_CLASS = 'flex-1 items-center rounded-xl bg-white py-3 active:bg-slate-200'
</script>

<template>
  <Page>
    <Stack.Screen :options="{ title: 'Haptics' }" />

    <Section
      title="Impact"
      footer="@nativue/haptics, a package with native code: its iOS and Android sides are linked when the app is built."
    >
      <View class="flex-row gap-2">
        <Pressable
          v-for="style in IMPACT_STYLES"
          :key="style"
          :class="BUTTON_CLASS"
          @press="Haptics.impact(style)"
        >
          <Text class="font-semibold text-slate-900">{{ style }}</Text>
        </Pressable>
      </View>
    </Section>

    <Section title="Notification">
      <View class="flex-row gap-2">
        <Pressable
          v-for="type in NOTIFICATION_TYPES"
          :key="type"
          :class="BUTTON_CLASS"
          @press="Haptics.notification(type)"
        >
          <Text class="font-semibold text-slate-900">{{ type }}</Text>
        </Pressable>
      </View>
    </Section>

    <Section title="Selection" footer="Simulators and emulators don't vibrate: try it on a phone.">
      <View class="flex-row">
        <Pressable :class="BUTTON_CLASS" @press="Haptics.selection()">
          <Text class="font-semibold text-slate-900">selection</Text>
        </Pressable>
      </View>
    </Section>
  </Page>
</template>
