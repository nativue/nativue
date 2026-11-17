<script setup lang="ts">
import { computed, LayoutAnimation, ref, StyleSheet, type Style } from 'vue'
import { useRouter } from 'vuenative/router'
import logo from '../../assets/vue-logo.png'
import { createItem, createItems, hideDoneItems, items, removeItem, type Item } from '../../store'

const ITEM_HEIGHT = 60

const router = useRouter()
const newItemText = ref('')
const refreshing = ref(false)

const visibleItems = computed(() =>
  hideDoneItems.value ? items.value.filter((item) => !item.done) : items.value,
)

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 24, paddingTop: 8, gap: 16 },
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
  row: { flex: 1, marginBottom: 8 },
  action: { width: 88, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  doneAction: { marginRight: 8, backgroundColor: '#42b883' },
  deleteAction: { marginLeft: 8, backgroundColor: '#ff3b30' },
  actionText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
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
})

function itemStyle(item: Item): Style {
  return {
    flex: 1,
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: item.done ? '#d8f3e6' : '#f2f2f7',
  }
}

// The rows below slide up into place.
function removeWithAnimation(item: Item) {
  LayoutAnimation.configureNext()
  removeItem(item)
}

function addItem() {
  const text = newItemText.value.trim() || `Item ${items.value.length + 1}`

  LayoutAnimation.configureNext()
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
  <View :style="styles.screen">
    <View :style="styles.subtitleRow">
      <Text :style="styles.subtitle">{{ items.length }} itens</Text>
      <ActivityIndicator v-if="refreshing" color="#8e8e93" />
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

    <!-- Reaches the bottom edge and scrolls under the tab bar; the inset keeps the last rows reachable. -->
    <FlatList
      :data="visibleItems"
      :item-height="ITEM_HEIGHT"
      :key-extractor="(item) => item.id"
      :style="styles.list"
      :refreshing="refreshing"
      content-inset-adjustment-behavior="automatic"
      @refresh="refresh"
    >
      <template #header>
        <Text :style="styles.listNote">Puxe para atualizar</Text>
      </template>

      <template #item="{ item }">
        <Swipeable :style="styles.row">
          <template #left-actions>
            <Pressable
              :style="{ ...styles.action, ...styles.doneAction }"
              :pressed-style="{ opacity: 0.6 }"
              @press="item.done = !item.done"
            >
              <Text :style="styles.actionText">{{ item.done ? 'Reabrir' : 'Concluir' }}</Text>
            </Pressable>
          </template>

          <template #right-actions>
            <Pressable
              :style="{ ...styles.action, ...styles.deleteAction }"
              :pressed-style="{ opacity: 0.6 }"
              @press="removeWithAnimation(item)"
            >
              <Text :style="styles.actionText">Apagar</Text>
            </Pressable>
          </template>

          <Pressable
            :style="itemStyle(item)"
            :pressed-style="{ opacity: 0.5 }"
            @press="router.push(`/items/${item.id}`)"
            @long-press="removeWithAnimation(item)"
          >
            <Text>{{ item.done ? '✓ ' : '' }}{{ item.text }}</Text>
          </Pressable>
        </Swipeable>
      </template>

      <template #empty>
        <Text :style="styles.listNote">Nenhum item</Text>
      </template>

      <template #footer>
        <Image :source="logo" resize-mode="contain" :style="styles.logo" />
        <Text :style="styles.listNote">Fim da lista</Text>
      </template>
    </FlatList>
  </View>
</template>
