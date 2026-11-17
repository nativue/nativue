<script setup lang="ts">
import { StyleSheet } from 'vue'
import { Link, Stack, useLocalSearchParams } from 'vuenative/router'

const { topic } = useLocalSearchParams<{ topic: string }>()

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 16 },
  text: { fontSize: 17 },
  link: { fontSize: 17, color: '#42b883' },
})
</script>

<template>
  <View :style="styles.screen">
    <Stack.Screen :options="{ title: topic }" />
    <Text :style="styles.text"
      >Esta tela está na pilha da aba Explorar: a barra de abas continua.</Text
    >
    <Link href="/items/1" push>
      <Text :style="styles.link">Abrir Item 1 por cima das abas ›</Text>
    </Link>
  </View>
</template>
