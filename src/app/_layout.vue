<script setup>
import { Stack } from 'vuenative/router'
</script>

<template>
  <Stack :screen-options="{ headerTintColor: '#42b883' }">
    <Stack.Screen name="about" :options="{ presentation: 'modal', title: 'Sobre' }" />
  </Stack>
</template>
