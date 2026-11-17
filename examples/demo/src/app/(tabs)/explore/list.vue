<script setup lang="ts">
import { computed, LayoutAnimation, ref, StyleSheet, type Style } from 'vue'
import { CheckIcon, ChevronRightIcon, PlusIcon } from 'vuenative-icons/lucide'
import { Stack, useRouter } from 'vuenative/router'
import {
  createItem,
  createItems,
  doneCount,
  hideDoneItems,
  items,
  removeItem,
  type Item,
} from '../../../store'
import { colors, radius, spacing } from '../../../theme'

const ROW_HEIGHT = 64

const router = useRouter()
const newItemText = ref('')
const refreshing = ref(false)

const visibleItems = computed(() =>
  hideDoneItems.value ? items.value.filter((item) => !item.done) : items.value,
)

const screenOptions = computed(() => ({
  title: 'Lists',
  headerRight: [
    {
      title: hideDoneItems.value ? 'Show done' : 'Hide done',
      onPress: () => (hideDoneItems.value = !hideDoneItems.value),
    },
  ],
}))

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  top: { paddingHorizontal: spacing.medium, paddingTop: spacing.medium, gap: 12 },
  summary: { fontSize: 13, fontWeight: '600', color: colors.secondaryText },
  form: { flexDirection: 'row', gap: 10 },
  input: {
    flex: 1,
    height: 48,
    paddingHorizontal: 14,
    borderRadius: radius.small,
    backgroundColor: colors.surface,
    fontSize: 17,
  },
  addButton: {
    width: 48,
    height: 48,
    borderRadius: radius.small,
    backgroundColor: colors.green,
    justifyContent: 'center',
    alignItems: 'center',
  },
  list: { flex: 1, paddingHorizontal: spacing.medium },
  row: { flex: 1, marginBottom: 8 },
  rowContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: spacing.medium,
    borderRadius: radius.small,
    backgroundColor: colors.surface,
  },
  rowText: { flex: 1, fontSize: 17, color: colors.text },
  action: { width: 84, borderRadius: radius.small, justifyContent: 'center', alignItems: 'center' },
  doneAction: { marginRight: 8, backgroundColor: colors.green },
  deleteAction: { marginLeft: 8, backgroundColor: colors.red },
  actionText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  note: { paddingVertical: 14, textAlign: 'center', fontSize: 13, color: colors.secondaryText },
})

function checkStyle(item: Item): Style {
  return {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    borderColor: item.done ? colors.green : colors.tertiaryText,
    backgroundColor: item.done ? colors.green : 'transparent',
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
  items.value.unshift(createItem(text))
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
    <Stack.Screen :options="screenOptions" />

    <View :style="styles.top">
      <View :style="styles.form">
        <TextInput
          v-model="newItemText"
          placeholder="New item"
          :style="styles.input"
          @submit-editing="addItem"
        />
        <Pressable :style="styles.addButton" :pressed-style="{ opacity: 0.8 }" @press="addItem">
          <PlusIcon :size="24" color="#ffffff" :stroke-width="2.5" />
        </Pressable>
      </View>
      <Text :style="styles.summary">
        {{ items.length.toLocaleString('en-US') }} ITEMS · {{ doneCount }} DONE
      </Text>
    </View>

    <FlatList
      :data="visibleItems"
      :item-height="ROW_HEIGHT"
      :key-extractor="(item: Item) => item.id"
      :style="styles.list"
      :refreshing="refreshing"
      content-inset-adjustment-behavior="automatic"
      @refresh="refresh"
    >
      <template #header>
        <Text :style="styles.note">Swipe a row either way · pull to refresh</Text>
      </template>

      <template #item="{ item }">
        <Swipeable :style="styles.row">
          <template #left-actions>
            <Pressable
              :style="{ ...styles.action, ...styles.doneAction }"
              :pressed-style="{ opacity: 0.7 }"
              @press="item.done = !item.done"
            >
              <Text :style="styles.actionText">{{ item.done ? 'Undo' : 'Done' }}</Text>
            </Pressable>
          </template>

          <template #right-actions>
            <Pressable
              :style="{ ...styles.action, ...styles.deleteAction }"
              :pressed-style="{ opacity: 0.7 }"
              @press="removeWithAnimation(item)"
            >
              <Text :style="styles.actionText">Delete</Text>
            </Pressable>
          </template>

          <Pressable
            :style="styles.rowContent"
            :pressed-style="{ backgroundColor: colors.pressed }"
            @press="router.push(`/explore/items/${item.id}`)"
          >
            <View :style="checkStyle(item)">
              <CheckIcon v-if="item.done" :size="14" color="#ffffff" :stroke-width="3" />
            </View>
            <Text :style="styles.rowText">{{ item.text }}</Text>
            <ChevronRightIcon :size="20" :color="colors.tertiaryText" />
          </Pressable>
        </Swipeable>
      </template>

      <template #empty>
        <Text :style="styles.note">Nothing here. Pull to bring the items back.</Text>
      </template>

      <template #footer>
        <Text :style="styles.note">End of the list</Text>
      </template>
    </FlatList>
  </View>
</template>
