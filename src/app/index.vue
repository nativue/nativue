<script setup>
import { computed, Keyboard, ref } from 'vue'
import { Stack, useRouter } from 'vuenative/router'
import logo from '../assets/vue-logo.png'
import { createItem, createItems, items, removeItem } from '../store.js'

const ITEM_HEIGHT = 60

const router = useRouter()
const newItemText = ref('')
const refreshing = ref(false)
const settingsVisible = ref(false)
const hideDoneItems = ref(false)

const visibleItems = computed(() =>
  hideDoneItems.value ? items.value.filter((item) => !item.done) : items.value,
)

const screenOptions = {
  headerRight: [{ systemImage: 'gearshape', onPress: () => (settingsVisible.value = true) }],
}

const styles = {
  screen: { flex: 1, paddingHorizontal: 24, paddingBottom: 24, gap: 16 },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  subtitle: { fontSize: 15, color: '#8e8e93' },
  logo: { width: 32, height: 32, alignSelf: 'center', marginTop: 12 },
  settings: { flex: 1, padding: 24, gap: 24 },
  settingsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  settingsTitle: { fontSize: 22, fontWeight: 'bold' },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  settingLabel: { fontSize: 17 },
  removeButton: { color: '#ff3b30', fontSize: 17 },
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
  listNote: { paddingVertical: 12, textAlign: 'center', color: '#8e8e93', fontSize: 13 },
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

// Simulates a reload from a server.
function refresh() {
  refreshing.value = true

  setTimeout(() => {
    items.value = createItems()
    refreshing.value = false
  }, 800)
}

function removeLastItem() {
  items.value.pop()
  Keyboard.dismiss()
}
</script>

<template>
  <SafeAreaView :style="{ flex: 1 }">
    <Stack.Screen :options="screenOptions" />

    <KeyboardAvoidingView behavior="padding" :style="{ flex: 1 }">
      <View :style="styles.screen">
        <View :style="styles.subtitleRow">
          <Text :style="styles.subtitle">{{ items.length }} itens</Text>
          <ActivityIndicator v-if="refreshing" color="#8e8e93" />
        </View>

        <FlatList
          :data="visibleItems"
          :item-height="ITEM_HEIGHT"
          :key-extractor="(item) => item.id"
          :style="styles.list"
          :refreshing="refreshing"
          @refresh="refresh"
        >
          <template #header>
            <Text :style="styles.listNote">Puxe para atualizar</Text>
          </template>

          <template #item="{ item }">
            <Pressable
              :style="itemStyle(item)"
              :pressed-style="{ opacity: 0.5 }"
              @press="router.push(`/items/${item.id}`)"
              @long-press="removeItem(item)"
            >
              <Text>{{ item.done ? '✓ ' : '' }}{{ item.text }}</Text>
            </Pressable>
          </template>

          <template #empty>
            <Text :style="styles.listNote">Nenhum item</Text>
          </template>

          <template #footer>
            <Image :source="logo" resize-mode="contain" :style="styles.logo" />
            <Text :style="styles.listNote">Fim da lista</Text>
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

    <Modal
      :visible="settingsVisible"
      animation-type="slide"
      presentation-style="pageSheet"
      @request-close="settingsVisible = false"
    >
      <View :style="styles.settings">
        <View :style="styles.settingsHeader">
          <Text :style="styles.settingsTitle">Ajustes</Text>
          <Button title="Fechar" @press="settingsVisible = false" />
        </View>

        <View :style="styles.settingRow">
          <Text :style="styles.settingLabel">Ocultar concluídos</Text>
          <Switch v-model="hideDoneItems" />
        </View>

        <Button title="Remover último" :style="styles.removeButton" @press="removeLastItem" />
      </View>
    </Modal>
  </SafeAreaView>
</template>
