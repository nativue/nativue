<script setup>
import { ref } from 'vue'

const count = ref(0)

const buttonStyle = {
  flex: 1,
  height: 52,
  borderRadius: 14,
  backgroundColor: '#42b883',
  color: '#ffffff',
  fontSize: 20,
  fontWeight: '600',
}
</script>

<template>
  <View :style="{ flex: 1, padding: 24, gap: 16 }">
    <Text :style="{ fontSize: 28, fontWeight: 'bold', color: '#42b883' }">Olá, Vue Native!</Text>

    <View :style="{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 }">
      <Text :style="{ fontSize: 96, fontWeight: '200' }">{{ count }}</Text>
      <Text v-if="count > 2" :style="{ color: '#35495e' }">Passou de 2 🎉</Text>
    </View>

    <View :style="{ flexDirection: 'row', gap: 12 }">
      <Button title="-1" :style="buttonStyle" @press="count--" />
      <Button title="+1" :style="buttonStyle" @press="count++" />
    </View>
  </View>
</template>
