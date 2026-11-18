<script setup lang="ts">
import { AsyncStorage, onMounted, onUnmounted, ref, StyleSheet } from 'vue'
import { Stack } from '@nativue/core/router'
import FieldRow from '@/components/FieldRow.vue'
import Page from '@/components/Page.vue'
import PrimaryButton from '@/components/PrimaryButton.vue'
import Section from '@/components/Section.vue'
import { colors, radius } from '@/lib/theme'

const POSTS_URL = 'https://jsonplaceholder.typicode.com/posts?_limit=5'
const VISITS_KEY = 'dataPageVisits'

interface Post {
  id: number
  title: string
}

const posts = ref<Post[]>([])
const loading = ref(false)
const errorMessage = ref('')
const visits = ref(0)
const seconds = ref(0)
const ticking = ref(true)

let clockId: number | null = null

const styles = StyleSheet.create({
  post: { padding: 14, borderRadius: radius.small, backgroundColor: colors.background },
  postTitle: { fontSize: 15, color: colors.text },
  error: { fontSize: 15, color: colors.red },
  value: { fontSize: 17, fontWeight: '700', color: colors.green },
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

async function resetVisits() {
  await AsyncStorage.removeItem(VISITS_KEY)
  visits.value = 0
}

function startClock() {
  clockId = setInterval(() => seconds.value++, 1000)
}

function stopClock() {
  clearInterval(clockId)
}

function toggleClock() {
  ticking.value = !ticking.value

  if (ticking.value) startClock()
  else stopClock()
}

onMounted(() => {
  countVisit()
  startClock()
})

onUnmounted(stopClock)
</script>

<template>
  <Page>
    <Stack.Screen :options="{ title: 'Data' }" />

    <Section title="fetch" footer="The native networking stack under the hood, the web API on top.">
      <PrimaryButton
        :title="posts.length > 0 ? 'Reload posts' : 'Load posts'"
        :tint="colors.teal"
        @press="loadPosts"
      />
      <ActivityIndicator v-if="loading" />
      <Text v-if="errorMessage" :style="styles.error">Error: {{ errorMessage }}</Text>
      <View v-for="post in posts" :key="post.id" :style="styles.post">
        <Text :style="styles.postTitle">{{ post.title }}</Text>
      </View>
    </Section>

    <Section
      title="AsyncStorage"
      footer="Kept in memory natively and saved to disk in the background."
    >
      <FieldRow label="Visits to this page" detail="Leave and come back, or relaunch the app">
        <Text :style="styles.value">{{ visits }}</Text>
      </FieldRow>
      <Button title="Reset" @press="resetVisits" />
    </Section>

    <Section title="Timers">
      <FieldRow label="Open for" detail="setInterval">
        <Text :style="styles.value">{{ seconds }} s</Text>
      </FieldRow>
      <Button :title="ticking ? 'Pause' : 'Resume'" @press="toggleClock" />
    </Section>
  </Page>
</template>
