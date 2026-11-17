<script setup lang="ts">
import { ref, type Style } from 'vue'

const ROW_COUNT = 1000

const round = ref(0)

// The native side detects this hook and drives the benchmark (see Benchmark.swift).
;(globalThis as { __benchmark?: object }).__benchmark = {
  update: () => round.value++,
}

function rowStyle(index: number): Style {
  return {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 8,
    backgroundColor: (index + round.value) % 2 ? '#ffffff' : '#f2f2f2',
  }
}
</script>

<template>
  <View :style="{ flex: 1 }">
    <View v-for="index in ROW_COUNT" :key="index" :style="rowStyle(index)">
      <Text>Row {{ index }}</Text>
      <Text>{{ index * round }}</Text>
    </View>
  </View>
</template>
