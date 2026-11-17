<script setup>
import { LayoutAnimation, computed, watch } from 'vue'
import { Link, Stack, useLocalSearchParams, useRouter } from 'vuenative/router'
import { findItem, items, removeItem } from '../../store.js'

const router = useRouter()
const { id } = useLocalSearchParams()
const item = computed(() => findItem(id))
const nextItem = computed(() => items.value[items.value.indexOf(item.value) + 1])

watch(
  () => item.value?.done,
  () => LayoutAnimation.configureNext(LayoutAnimation.Presets.spring),
)

const styles = {
  screen: { flex: 1, padding: 24, gap: 24 },
  text: { fontSize: 28, fontWeight: 'bold' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 17 },
  link: { padding: 16, borderRadius: 12, backgroundColor: '#f2f2f7' },
  linkText: { fontSize: 17, color: '#42b883' },
  deleteButton: { color: '#ff3b30', fontSize: 17 },
  badgeText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
}

function badgeStyle(done) {
  return {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: done ? '#42b883' : '#c7c7cc',
    opacity: done ? 1 : 0.5,
    transform: [{ scale: done ? 1.15 : 1 }, { rotate: done ? '-4deg' : '0deg' }],
  }
}

function deleteItem() {
  removeItem(item.value)
  router.back()
}
</script>

<template>
  <View :style="styles.screen">
    <Stack.Screen :options="{ title: item?.text ?? 'Item', headerBackTitle: 'Lista' }" />

    <template v-if="item">
      <Text :style="styles.text">{{ item.text }}</Text>

      <View :style="badgeStyle(item.done)">
        <Text :style="styles.badgeText">{{ item.done ? 'Concluído!' : 'Pendente' }}</Text>
      </View>

      <View :style="styles.row">
        <Text :style="styles.label">Concluído</Text>
        <Switch v-model="item.done" />
      </View>

      <Link v-if="nextItem" :href="`/items/${nextItem.id}`" :style="styles.link">
        <Text :style="styles.linkText">Próximo: {{ nextItem.text }} ›</Text>
      </Link>

      <Button title="Excluir item" :style="styles.deleteButton" @press="deleteItem" />
    </template>

    <Text v-else>Item não encontrado.</Text>
  </View>
</template>
