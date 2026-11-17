<script setup>
import { ref } from 'vue'
const count = ref(0)
</script>

<template>
  <view :style="{ padding: 24, gap: 12 }">
    <text :style="{ fontSize: 28, color: '#42b883' }">Olá, Vue Native!</text>
    <text>Contador: {{ count }}</text>
    <view :style="{ flexDirection: 'row', gap: 8 }">
      <button title="-1" @press="count--" />
      <button title="+1" @press="count++" />
    </view>
    <text v-if="count > 2">Passou de 2 🎉</text>
  </view>
</template>
