<script setup lang="ts">
import { Stack } from '@nativue/core/router'
import Page from '@/components/Page.vue'
import Section from '@/components/Section.vue'

const SWATCH = { height: 72, borderRadius: 16 }
const LINEAR = [
  'linear-gradient(135deg, #4af2ae, #10b39b)',
  'linear-gradient(to right, #ff9500, #ff2d55 50%, #af52de)',
  'linear-gradient(to top right in oklab, #0b1220, #0e9f84)',
]
const RADIAL = [
  'radial-gradient(circle at top left, #4af2ae, #0b1220 80%)',
  'radial-gradient(ellipse closest-side, #ffd60a, #ff9500 60%, transparent)',
]
</script>

<template>
  <Page>
    <Stack.Screen :options="{ title: 'Gradients' }" />

    <Section title="Linear" footer="backgroundImage: 'linear-gradient(...)', as in CSS.">
      <View class="gap-3">
        <View
          v-for="backgroundImage in LINEAR"
          :key="backgroundImage"
          :style="{ ...SWATCH, backgroundImage }"
        />
      </View>
    </Section>

    <Section title="Radial">
      <View class="flex-row gap-3">
        <View
          v-for="backgroundImage in RADIAL"
          :key="backgroundImage"
          :style="{ ...SWATCH, flex: 1, height: 120, backgroundImage }"
        />
      </View>
    </Section>

    <Section
      title="With the rest of the box"
      footer="Corners, a border and a shadow, and two layers: a glow over a gradient."
    >
      <View
        :style="{
          height: 140,
          borderRadius: 24,
          borderWidth: 2,
          borderColor: '#4af2ae',
          shadowColor: '#0b1220',
          shadowOpacity: 0.25,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
          backgroundImage:
            'radial-gradient(circle at 80% 20%, rgba(255, 255, 255, 0.6), transparent 40%), linear-gradient(160deg, #10b39b, #0b1220)',
          padding: 20,
          justifyContent: 'flex-end',
        }"
      >
        <Text :style="{ color: 'white', fontSize: 20, fontWeight: '700' }">nativue</Text>
      </View>
    </Section>
  </Page>
</template>
