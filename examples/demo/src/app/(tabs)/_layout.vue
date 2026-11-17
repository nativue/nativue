<script setup lang="ts">
import { Tabs } from 'vuenative/router'
</script>

<template>
  <Tabs>
    <Tabs.Screen
      name="index"
      :options="{ title: 'Welcome', tabBarIcon: 'sparkles', headerShown: false }"
    />
    <Tabs.Screen
      name="explore"
      :options="{ title: 'Explore', tabBarIcon: 'square.grid.2x2', lazy: true }"
    />
  </Tabs>
</template>
