<script setup>
import { Keyboard, ref } from 'vue'
import logo from './assets/vue-logo.png'

const ITEM_HEIGHT = 60

let nextItemId = 1
const items = ref(Array.from({ length: 1000 }, (_, index) => createItem(`Item ${index + 1}`)))
const newItemText = ref('')

const styles = {
  screen: { flex: 1, padding: 24, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logo: { width: 44, height: 44 },
  headerText: { flex: 1, gap: 4 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#42b883' },
  subtitle: { fontSize: 15, color: '#8e8e93' },
  removeButton: { color: '#ff3b30', fontSize: 15 },
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
  list: { flex: 1 },
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

function createItem(text) {
  return { id: nextItemId++, text, done: false }
}

function itemStyle(item) {
  return {
    flex: 1,
    marginBottom: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: item.done ? '#d8f3e6' : '#f2f2f7',
  }
}

function addItem() {
  const text = newItemText.value.trim() || `Item ${items.value.length + 1}`

  items.value.push(createItem(text))
  newItemText.value = ''
}

function removeItem(item) {
  items.value.splice(items.value.indexOf(item), 1)
}

function removeLastItem() {
  items.value.pop()
  Keyboard.dismiss()
}
</script>

<template>
  <SafeAreaView :style="{ flex: 1 }">
    <KeyboardAvoidingView behavior="padding" :style="{ flex: 1 }">
      <View :style="styles.screen">
        <View :style="styles.header">
          <Image :source="logo" resize-mode="contain" :style="styles.logo" />
          <View :style="styles.headerText">
            <Text :style="styles.title">Vue Native</Text>
            <Text :style="styles.subtitle">{{ items.length }} itens</Text>
          </View>
          <Button title="Remover último" :style="styles.removeButton" @press="removeLastItem" />
        </View>

        <FlatList
          :data="items"
          :item-height="ITEM_HEIGHT"
          :key-extractor="(item) => item.id"
          :style="styles.list"
        >
          <template #item="{ item }">
            <Pressable
              :style="itemStyle(item)"
              :pressed-style="{ opacity: 0.5 }"
              @press="item.done = !item.done"
              @long-press="removeItem(item)"
            >
              <Text>{{ item.done ? '✓ ' : '' }}{{ item.text }}</Text>
            </Pressable>
          </template>
        </FlatList>

        <View :style="styles.form">
          <TextInput
            v-model="newItemText"
            placeholder="Novo item"
            :style="styles.input"
            @submit-editing="addItem"
          />
          <Button title="Adicionar" :style="styles.button" @press="addItem" />
        </View>
      </View>
    </KeyboardAvoidingView>
  </SafeAreaView>
</template>
