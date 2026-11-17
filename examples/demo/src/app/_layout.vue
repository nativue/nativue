<script setup lang="ts">
import { Stack } from 'vuenative/router'
import { colors } from '@/lib/theme'
</script>

<template>
  <Stack :screen-options="{ headerTintColor: colors.green }">
    <Stack.Screen name="modal" :options="{ presentation: 'modal', title: 'Modal' }" />
  </Stack>
</template>
