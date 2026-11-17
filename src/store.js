// List state shared by the screens in src/app.
import { computed, ref } from 'vue'

let nextItemId = 1

export const items = ref(createItems())
export const hideDoneItems = ref(false)
export const doneCount = computed(() => items.value.filter((item) => item.done).length)

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
