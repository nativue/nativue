<script setup lang="ts">
import { LayoutGridIcon, SparklesIcon } from '@nativue/icons/lucide'
import { Tabs } from '@nativue/core/router'
import { colors } from '@/lib/theme'
</script>

<template>
  <Tabs
    :screen-options="{
      tabBarActiveTintColor: colors.green,
      tabBarInactiveTintColor: colors.secondaryText,
      tabBarBackgroundColor: colors.surface,
    }"
  >
    <Tabs.Screen
      name="index"
      :options="{ title: 'Welcome', tabBarIcon: SparklesIcon, headerShown: false }"
    />
    <Tabs.Screen
      name="explore"
      :options="{ title: 'Explore', tabBarIcon: LayoutGridIcon, lazy: true }"
    />
  </Tabs>
</template>
