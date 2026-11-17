<script setup>
import { computed, ref } from 'vue'

const itemCount = ref(20)

const items = computed(() => Array.from({ length: itemCount.value }, (_, index) => index + 1))

const styles = {
  screen: { flex: 1, padding: 24, gap: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 28, fontWeight: 'bold', color: '#42b883' },
  counter: { fontSize: 28, fontWeight: '200' },
  list: { flex: 1, gap: 8 },
  item: { padding: 16, borderRadius: 12, backgroundColor: '#f2f2f7' },
  actions: { flexDirection: 'row', gap: 12 },
  button: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#42b883',
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '600',
  },
}

function removeItem() {
  itemCount.value = Math.max(0, itemCount.value - 1)
}

function addItem() {
  itemCount.value++
}
</script>

<template>
  <SafeAreaView :style="{ flex: 1 }">
    <View :style="styles.screen">
      <View :style="styles.header">
        <Text :style="styles.title">Olá, Vue Native!</Text>
        <Text :style="styles.counter">{{ itemCount }}</Text>
      </View>

      <ScrollView :style="styles.list">
        <View v-for="item in items" :key="item" :style="styles.item">
          <Text>Item {{ item }}</Text>
        </View>
      </ScrollView>

      <View :style="styles.actions">
        <Button title="-1" :style="styles.button" @press="removeItem" />
        <Button title="+1" :style="styles.button" @press="addItem" />
      </View>
    </View>
  </SafeAreaView>
</template>
