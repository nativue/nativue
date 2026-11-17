<script setup>
import { Tabs } from 'vuenative/router'
import { doneCount } from '../../store.js'
</script>

<template>
  <Tabs>
    <Tabs.Screen
      name="index"
      :options="{
        title: 'Vue Native',
        tabBarLabel: 'Lista',
        tabBarIcon: 'list.bullet',
        tabBarBadge: doneCount || undefined,
      }"
    />
    <Tabs.Screen name="explore" :options="{ title: 'Explorar', tabBarIcon: 'safari' }" />
    <Tabs.Screen name="settings" :options="{ title: 'Ajustes', tabBarIcon: 'gearshape' }" />
  </Tabs>
</template>
