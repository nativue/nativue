// List state shared by the screens in src/app.
import { ref } from 'vue'

let nextItemId = 1

export const items = ref(createItems())

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
