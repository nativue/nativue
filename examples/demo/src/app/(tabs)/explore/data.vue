<script setup lang="ts">
import { AsyncStorage, onMounted, onUnmounted, ref, StyleSheet } from 'vue'
import { Stack } from 'vuenative/router'

const POSTS_URL = 'https://jsonplaceholder.typicode.com/posts?_limit=5'
const VISITS_KEY = 'dataPageVisits'

interface Post {
  id: number
  title: string
}

const posts = ref<Post[]>([])
const loading = ref(false)
const errorMessage = ref('')
const secondsOpen = ref(0)
const visits = ref(0)

let clockId: number | null = null

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 16 },
  label: { fontSize: 15, color: '#8e8e93' },
  post: { padding: 14, borderRadius: 12, backgroundColor: '#f2f2f7' },
  postTitle: { fontSize: 15 },
  error: { fontSize: 15, color: '#ff3b30' },
})

async function loadPosts() {
  loading.value = true
  errorMessage.value = ''

  try {
    const response = await fetch(POSTS_URL)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    posts.value = await response.json()
  } catch (error) {
    errorMessage.value = (error as Error).message
  } finally {
    loading.value = false
  }
}

async function countVisit() {
  visits.value = Number((await AsyncStorage.getItem(VISITS_KEY)) ?? 0) + 1
  await AsyncStorage.setItem(VISITS_KEY, visits.value)
}

onMounted(() => {
  countVisit()
  clockId = setInterval(() => secondsOpen.value++, 1000)
})

onUnmounted(() => clearInterval(clockId))
</script>

<template>
  <View :style="styles.screen">
    <Stack.Screen :options="{ title: 'Dados' }" />

    <Text :style="styles.label">Página aberta há {{ secondsOpen }} s (setInterval)</Text>
    <Text :style="styles.label">Visitas a esta página: {{ visits }} (AsyncStorage)</Text>

    <Button title="Carregar posts (fetch)" @press="loadPosts" />
    <ActivityIndicator v-if="loading" />
    <Text v-if="errorMessage" :style="styles.error">Erro: {{ errorMessage }}</Text>

    <View v-for="post in posts" :key="post.id" :style="styles.post">
      <Text :style="styles.postTitle">{{ post.title }}</Text>
    </View>
  </View>
</template>
