<script setup>
import { computed, ref } from 'vue'

const itemCount = ref(20)

const items = computed(() => Array.from({ length: itemCount.value }, (_, index) => index + 1))

const buttonStyle = {
  flex: 1,
  height: 52,
  borderRadius: 14,
  backgroundColor: '#42b883',
  color: '#ffffff',
  fontSize: 20,
  fontWeight: '600',
}

const itemStyle = {
  padding: 16,
  borderRadius: 12,
  backgroundColor: '#f2f2f7',
}

function removeItem() {
  itemCount.value = Math.max(0, itemCount.value - 1)
}

function addItem() {
  itemCount.value++
}
</script>

<template>
  <View :style="{ flex: 1, padding: 24, gap: 16 }">
    <View :style="{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }">
      <Text :style="{ fontSize: 28, fontWeight: 'bold', color: '#42b883' }">Olá, Vue Native!</Text>
      <Text :style="{ fontSize: 28, fontWeight: '200' }">{{ itemCount }}</Text>
    </View>

    <ScrollView :style="{ flex: 1, gap: 8 }">
      <View v-for="item in items" :key="item" :style="itemStyle">
        <Text>Item {{ item }}</Text>
      </View>
    </ScrollView>

    <View :style="{ flexDirection: 'row', gap: 12 }">
      <Button title="-1" :style="buttonStyle" @press="removeItem" />
      <Button title="+1" :style="buttonStyle" @press="addItem" />
    </View>
  </View>
</template>
