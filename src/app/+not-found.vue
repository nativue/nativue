<script setup>
import { Link, Stack } from 'vuenative/router'
</script>

<template>
  <View :style="{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }">
    <Stack.Screen :options="{ title: 'Ops!' }" />
    <Text :style="{ fontSize: 17 }">Essa tela não existe.</Text>
    <Link href="/">
      <Text :style="{ fontSize: 17, color: '#42b883' }">Voltar para o início</Text>
    </Link>
  </View>
</template>
