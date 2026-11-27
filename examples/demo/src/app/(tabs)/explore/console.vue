<script setup lang="ts">
import { Stack } from '@nativue/core/router'
import Page from '@/components/Page.vue'
import Section from '@/components/Section.vue'

const BUTTON_CLASS =
  'w-[31%] items-center rounded-xl bg-white py-3 active:bg-slate-200 dark:bg-slate-800 dark:active:bg-slate-700'

const order = { id: 42, items: [{ name: 'Coffee', price: 4.5 }], paid: false }

const examples: { label: string; run: () => void }[] = [
  { label: 'log', run: () => console.log('Order', order) },
  { label: 'info', run: () => console.info('Signed in as %s', 'ana@example.com') },
  { label: 'debug', run: () => console.debug('Cache hit for', '/products') },
  { label: 'warn', run: () => console.warn('The token expires in %d minutes', 5) },
  { label: 'error', run: () => console.error(new Error('Payment declined')) },
  { label: 'trace', run: () => console.trace('Who saved?') },
  {
    label: 'table',
    run: () =>
      console.table([
        { name: 'Coffee', price: 4.5 },
        { name: 'Bagel', price: 3 },
      ]),
  },
  {
    label: 'group',
    run: () => {
      console.group('Checkout')
      console.log('Cart validated')
      console.log('Paid')
      console.groupEnd()
    },
  },
  { label: 'assert', run: () => console.assert(order.paid, 'Order %d is not paid', order.id) },
]
</script>

<template>
  <Page>
    <Stack.Screen :options="{ title: 'Console' }" />

    <Section
      title="Print"
      footer="Shows in the terminal running npm run dev, and in Xcode's console and Logcat."
    >
      <View class="flex-row flex-wrap gap-2">
        <Pressable
          v-for="example in examples"
          :key="example.label"
          :class="BUTTON_CLASS"
          @press="example.run"
        >
          <Text class="font-semibold text-slate-900 dark:text-white">{{ example.label }}</Text>
        </Pressable>
      </View>
    </Section>
  </Page>
</template>
