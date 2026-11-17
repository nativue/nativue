<script setup>
import { Link } from 'vuenative/router'

const TOPICS = ['componentes', 'navegacao', 'layout']

const styles = {
  screen: { flex: 1, padding: 24, gap: 12 },
  link: { padding: 16, borderRadius: 12, backgroundColor: '#f2f2f7' },
  linkText: { fontSize: 17 },
}
</script>

<template>
  <View :style="styles.screen">
    <Link href="/explore/gestures" :style="styles.link">
      <Text :style="styles.linkText">Gestos ›</Text>
    </Link>

    <Link v-for="topic in TOPICS" :key="topic" :href="`/explore/${topic}`" :style="styles.link">
      <Text :style="styles.linkText">{{ topic }} ›</Text>
    </Link>
  </View>
</template>
