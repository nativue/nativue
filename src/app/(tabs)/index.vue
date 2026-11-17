<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vuenative/router'
import logo from '../../assets/vue-logo.png'
import { createItem, createItems, hideDoneItems, items, removeItem } from '../../store.js'

const ITEM_HEIGHT = 60

const router = useRouter()
const newItemText = ref('')
const refreshing = ref(false)

const visibleItems = computed(() =>
  hideDoneItems.value ? items.value.filter((item) => !item.done) : items.value,
)

const styles = {
  screen: { flex: 1, paddingHorizontal: 24, paddingBottom: 24, gap: 16 },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  subtitle: { fontSize: 15, color: '#8e8e93' },
  logo: { width: 32, height: 32, alignSelf: 'center', marginTop: 12 },
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
</script>

<template>
  <SafeAreaView :style="{ flex: 1 }">
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
  </SafeAreaView>
</template>
