<script setup>
import { ref } from 'vue'
const count = ref(0)
</script>

<template>
  <View :style="{ padding: 24, gap: 12 }">
    <Text :style="{ fontSize: 28, color: '#42b883' }">Olá, Vue Native!</Text>
    <Text>Contador: {{ count }}</Text>
    <View :style="{ flexDirection: 'row', gap: 8 }">
      <Button title="-1" @press="count--" />
      <Button title="+1" @press="count++" />
    </View>
    <Text v-if="count > 2">Passou de 2 🎉</Text>
  </View>
</template>
