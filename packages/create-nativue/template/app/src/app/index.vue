<script setup lang="ts">
import { computed, ref, StyleSheet, useColorScheme } from 'vue'
import logo from '@/assets/logo.png'
import logoDark from '@/assets/logo-dark.png'

// Light or dark with the system.
const COLORS = {
  light: { background: '#ffffff', title: '#0b1220', hint: '#64748b' },
  dark: { background: '#0b1220', title: '#f1f5f9', hint: '#94a3b8' },
}

const count = ref(0)
const colorScheme = useColorScheme()

// A computed, so the styles are made again when colorScheme changes.
const styles = computed(() => {
  const colors = COLORS[colorScheme.value]

  return StyleSheet.create({
    screen: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      gap: 16,
      padding: 32,
      backgroundColor: colors.background,
    },
    logo: { width: 96, height: 96, marginBottom: 8 },
    title: { fontSize: 28, fontWeight: '800', color: colors.title },
    hint: { fontSize: 16, textAlign: 'center', color: colors.hint },
    button: {
      marginTop: 16,
      paddingHorizontal: 24,
      paddingVertical: 14,
      borderRadius: 14,
      backgroundColor: '#0e9f84',
    },
    buttonPressed: { opacity: 0.85 },
    buttonText: { fontSize: 17, fontWeight: '600', color: '#ffffff' },
  })
})
</script>

<template>
  <View :style="styles.screen">
    <Image
      :source="colorScheme === 'dark' ? logoDark : logo"
      alt="nativue"
      resize-mode="contain"
      :style="styles.logo"
    />
    <Text :style="styles.title">Welcome to nativue</Text>
    <Text :style="styles.hint">Edit src/app/index.vue and save to see it here.</Text>
    <Pressable :style="styles.button" :pressed-style="styles.buttonPressed" @press="count++">
      <Text :style="styles.buttonText">Tapped {{ count }} times</Text>
    </Pressable>
  </View>
</template>
