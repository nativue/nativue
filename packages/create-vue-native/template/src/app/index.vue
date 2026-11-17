<script setup lang="ts">
import { ref, StyleSheet } from 'vue'
import logo from '@/assets/logo.png'

const count = ref(0)

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    padding: 32,
    backgroundColor: '#ffffff',
  },
  logo: { width: 96, height: 96, marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '800', color: '#0b1220' },
  hint: { fontSize: 16, textAlign: 'center', color: '#64748b' },
  button: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#10b39b',
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: { fontSize: 17, fontWeight: '600', color: '#ffffff' },
})
</script>

<template>
  <View :style="styles.screen">
    <Image :source="logo" resize-mode="contain" :style="styles.logo" />
    <Text :style="styles.title">Welcome to Vue Native</Text>
    <Text :style="styles.hint">Edit src/app/index.vue and save to see it here.</Text>
    <Pressable :style="styles.button" :pressed-style="styles.buttonPressed" @press="count++">
      <Text :style="styles.buttonText">Tapped {{ count }} times</Text>
    </Pressable>
  </View>
</template>
