<script setup lang="ts">
import { StyleSheet } from 'vue'
import { Link, Stack, useRouter } from 'vuenative/router'
import { items } from '../store'

const router = useRouter()

const screenOptions = { headerRight: [{ title: 'Fechar', onPress: () => router.back() }] }

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 16 },
  text: { fontSize: 17 },
  link: { fontSize: 17, color: '#42b883' },
})
</script>

<template>
  <View :style="styles.screen">
    <Stack.Screen :options="screenOptions" />
    <Text :style="styles.text"
      >Uma rota com presentation: 'modal'. Puxe para baixo para fechar.</Text
    >
    <Text :style="styles.text">{{ items.length }} itens na lista.</Text>
    <Link href="/items/1" push>
      <Text :style="styles.link">Abrir Item 1 dentro do modal ›</Text>
    </Link>
  </View>
</template>
