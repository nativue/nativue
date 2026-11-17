<script setup lang="ts">
import { StyleSheet } from 'vue'
import { Stack, useLocalSearchParams, useRouter } from 'vuenative/router'
import Page from '@/components/Page.vue'
import PrimaryButton from '@/components/PrimaryButton.vue'
import Section from '@/components/Section.vue'
import { colors } from '@/lib/theme'

const router = useRouter()
const depth = Number(useLocalSearchParams<{ depth: string }>().depth)

const styles = StyleSheet.create({
  depth: { fontSize: 96, fontWeight: '800', color: colors.green, textAlign: 'center' },
  caption: { fontSize: 15, color: colors.secondaryText, textAlign: 'center' },
})
</script>

<template>
  <Page>
    <Stack.Screen :options="{ title: `Screen ${depth}` }" />

    <View>
      <Text :style="styles.depth">{{ depth }}</Text>
      <Text :style="styles.caption">screens deep · swipe from the edge to go back</Text>
    </View>

    <Section>
      <PrimaryButton
        title="Push another"
        @press="router.push(`/explore/navigation/${depth + 1}`)"
      />
      <Button title="Back" @press="router.back()" />
      <Button title="Pop to Navigation" @press="router.navigate('/explore/navigation')" />
    </Section>
  </Page>
</template>
