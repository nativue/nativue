<script setup lang="ts">
import { Platform, ref } from 'vue'
import { Stack } from '@nativue/core/router'
import Page from '@/components/Page.vue'
import Section from '@/components/Section.vue'

const PLANS = ['Free', 'Pro', 'Team']
const PALETTE = [
  'bg-red-500',
  'bg-orange-500',
  'bg-amber-400',
  'bg-emerald-500',
  'bg-sky-500',
  'bg-violet-500',
]
const BRAND_COLORS = ['bg-ink', 'bg-brand', 'bg-mint', 'bg-mist']

const selectedPlan = ref('Pro')
</script>

<template>
  <Page>
    <Stack.Screen :options="{ title: 'Tailwind' }" />

    <View class="gap-3 overflow-hidden rounded-3xl bg-ink p-6 shadow-lg">
      <View class="absolute -top-16 -right-12 size-48 rounded-full bg-mint opacity-30" />
      <Text class="text-xs font-bold text-mint">@NATIVUE/TAILWIND</Text>
      <Text class="text-3xl font-extrabold text-white">Utility classes, native views.</Text>
      <Text class="text-base text-white/70">
        Tailwind generates the CSS when the app is built; nativue turns it into native styles.
      </Text>
    </View>

    <Section title="Layout" footer="flex-row, gap-2, aspect-square, rounded-xl.">
      <View class="flex-row gap-2">
        <View
          v-for="number in 4"
          :key="number"
          class="aspect-square flex-1 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-950"
        >
          <Text class="text-lg font-bold text-emerald-700 dark:text-emerald-300">{{ number }}</Text>
        </View>
      </View>
    </Section>

    <Section title="Dynamic classes" footer=":class follows the state, like on the web.">
      <View class="flex-row gap-2">
        <Pressable
          v-for="plan in PLANS"
          :key="plan"
          class="flex-1 items-center rounded-full border-2 py-2"
          :class="
            plan === selectedPlan
              ? 'border-brand bg-brand'
              : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'
          "
          @press="selectedPlan = plan"
        >
          <Text
            class="font-semibold"
            :class="plan === selectedPlan ? 'text-white' : 'text-slate-600 dark:text-slate-300'"
          >
            {{ plan }}
          </Text>
        </Pressable>
      </View>
    </Section>

    <Section
      title="Colors"
      footer="Tailwind's palette, opacity modifiers (/50) and the app's own colors from src/tailwind.css."
    >
      <View class="flex-row justify-between">
        <View v-for="color in PALETTE" :key="color" class="size-10 rounded-full" :class="color" />
      </View>
      <View class="flex-row gap-2">
        <View class="h-10 flex-1 rounded-lg bg-sky-500" />
        <View class="h-10 flex-1 rounded-lg bg-sky-500/50" />
        <View class="h-10 flex-1 rounded-lg bg-sky-500/20" />
      </View>
      <View class="flex-row gap-2">
        <View
          v-for="color in BRAND_COLORS"
          :key="color"
          class="h-10 flex-1 rounded-lg border border-slate-200 dark:border-slate-700"
          :class="color"
        />
      </View>
    </Section>

    <Section
      title="Variants"
      footer="active: while pressed, focus: while typing, disabled: when disabled, dark: with the system's dark mode, ios: and android: per platform."
    >
      <Pressable class="items-center rounded-xl bg-brand py-3 active:scale-95 active:bg-ink">
        <Text class="font-semibold text-white">Press me</Text>
      </Pressable>
      <TextInput
        placeholder="Focus me"
        class="h-11 rounded-xl border-2 border-slate-200 px-3 focus:border-brand dark:border-slate-700 dark:focus:border-brand"
      />
      <Pressable
        disabled
        class="items-center rounded-xl bg-brand py-3 disabled:bg-slate-300 dark:disabled:bg-slate-700"
      >
        <Text class="font-semibold text-white">Disabled</Text>
      </Pressable>
      <View class="rounded-xl border border-slate-200 bg-white p-4 dark:border-ink dark:bg-ink">
        <Text class="text-slate-900 dark:text-mint">This card follows dark mode</Text>
      </View>
      <View class="rounded-xl p-4 ios:bg-sky-100 android:bg-emerald-100">
        <Text class="font-semibold ios:text-sky-700 android:text-emerald-700">
          {{ Platform.OS === 'ios' ? 'Blue on iOS' : 'Green on Android' }}
        </Text>
      </View>
    </Section>

    <Section title="With style" footer="style wins over class, as inline styles do on the web.">
      <View
        class="h-12 items-center justify-center rounded-xl bg-sky-500"
        :style="{ backgroundColor: '#af52de' }"
      >
        <Text class="font-semibold text-white">class="bg-sky-500", style purple</Text>
      </View>
      <View class="flex-row items-center gap-3">
        <View class="size-10 rotate-45 rounded-md bg-amber-400" />
        <View class="size-10 scale-75 rounded-md bg-amber-400" />
        <View class="size-10 translate-y-2 rounded-md bg-amber-400" />
        <Text class="flex-1 text-sm text-slate-500 dark:text-slate-400">
          rotate-45, scale-75, translate-y-2
        </Text>
      </View>
    </Section>

    <Section
      title="Text and corners"
      footer="italic, uppercase, tracking-*, leading-*, line-clamp-*, truncate, rounded-t-*."
    >
      <View class="rounded-t-2xl bg-emerald-500 p-4">
        <Text class="text-xs font-semibold tracking-widest text-white uppercase">
          Rounded on top
        </Text>
        <Text class="text-white italic">and italic below</Text>
      </View>
      <Text class="line-clamp-2 leading-6 text-slate-700 dark:text-slate-300">
        A long paragraph that line-clamp-2 cuts after its second line, ending it with an ellipsis,
        however much text follows it on a narrow phone screen.
      </Text>
      <Text class="truncate text-slate-500 dark:text-slate-400">
        truncate keeps this sentence on one line, however long it gets on the screen.
      </Text>
    </Section>
  </Page>
</template>
