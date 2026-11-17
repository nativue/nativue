<script setup>
import { ref } from 'vue'

const items = ref(Array.from({ length: 20 }, (_, index) => `Item ${index + 1}`))
const newItemText = ref('')

const styles = {
  screen: { flex: 1, padding: 24, gap: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 28, fontWeight: 'bold', color: '#42b883' },
  counter: { fontSize: 28, fontWeight: '200' },
  form: { flexDirection: 'row', gap: 12 },
  input: {
    flex: 1,
    height: 52,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#d1d1d6',
    fontSize: 17,
  },
  list: { flex: 1, gap: 8 },
  item: { padding: 16, borderRadius: 12, backgroundColor: '#f2f2f7' },
  button: {
    height: 52,
    paddingHorizontal: 20,
    borderRadius: 14,
    backgroundColor: '#42b883',
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '600',
  },
}

function addItem() {
  const text = newItemText.value.trim() || `Item ${items.value.length + 1}`

  items.value.push(text)
  newItemText.value = ''
}

function removeLastItem() {
  items.value.pop()
}
</script>

<template>
  <SafeAreaView :style="{ flex: 1 }">
    <View :style="styles.screen">
      <View :style="styles.header">
        <Text :style="styles.title">Olá, Vue Native!</Text>
        <Text :style="styles.counter">{{ items.length }}</Text>
      </View>

      <View :style="styles.form">
        <TextInput
          v-model="newItemText"
          placeholder="Novo item"
          :style="styles.input"
          @submit-editing="addItem"
        />
        <Button title="Adicionar" :style="styles.button" @press="addItem" />
      </View>

      <ScrollView :style="styles.list">
        <View v-for="(item, index) in items" :key="index" :style="styles.item">
          <Text>{{ item }}</Text>
        </View>
      </ScrollView>

      <Button title="Remover último" :style="styles.button" @press="removeLastItem" />
    </View>
  </SafeAreaView>
</template>
