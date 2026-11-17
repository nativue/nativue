// List state shared by the screens in src/app, saved with AsyncStorage.
import { AsyncStorage, computed, ref, watch } from 'vue'

const ITEMS_KEY = 'items'
const HIDE_DONE_ITEMS_KEY = 'hideDoneItems'

let nextItemId = 1

export const items = ref(createItems())
export const hideDoneItems = ref(false)
export const doneCount = computed(() => items.value.filter((item) => item.done).length)

restoreSavedState()

// Storage answers before the first frame (native reads are synchronous), so saved items replace the
// generated ones without a flash. Saving starts after restoring, so restoring doesn't save.
async function restoreSavedState() {
  const [[, savedItems], [, savedHideDoneItems]] = await AsyncStorage.multiGet([
    ITEMS_KEY,
    HIDE_DONE_ITEMS_KEY,
  ])

  if (savedItems) {
    items.value = JSON.parse(savedItems)
    nextItemId = Math.max(0, ...items.value.map((item) => item.id)) + 1
  }
  if (savedHideDoneItems) hideDoneItems.value = savedHideDoneItems === 'true'

  watch(items, (value) => AsyncStorage.setItem(ITEMS_KEY, JSON.stringify(value)), { deep: true })
  watch(hideDoneItems, (value) => AsyncStorage.setItem(HIDE_DONE_ITEMS_KEY, String(value)))
}

export function createItems() {
  return Array.from({ length: 1000 }, (_, index) => createItem(`Item ${index + 1}`))
}

export function createItem(text) {
  return { id: nextItemId++, text, done: false }
}

export function findItem(id) {
  return items.value.find((item) => item.id === Number(id))
}

export function removeItem(item) {
  items.value.splice(items.value.indexOf(item), 1)
}

export function removeLastItem() {
  items.value.pop()
}
