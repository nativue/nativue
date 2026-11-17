<script setup lang="ts">
import { StyleSheet } from 'vue'
import { Stack } from 'vuenative/router'
import logo from '@/assets/vue-logo.png'
import DemoRow from '@/components/DemoRow.vue'
import Page from '@/components/Page.vue'
import Section from '@/components/Section.vue'
import { demoSections } from '@/lib/demos'
import { cardShadow, colors, radius, spacing } from '@/lib/theme'

const demoCount = demoSections.reduce((count, section) => count + section.demos.length, 0)
const HIGHLIGHTS = [`${demoCount} demos`, '100% native', 'TypeScript']

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 28, height: 28 },
  brandName: { flex: 1, fontSize: 20, fontWeight: '800', color: colors.navy },
  platforms: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: colors.greenSoft,
  },
  platformsText: { fontSize: 13, fontWeight: '700', color: colors.green },
  hero: {
    padding: spacing.large,
    gap: 12,
    borderRadius: radius.large,
    backgroundColor: colors.navy,
    overflow: 'hidden',
    ...cardShadow,
  },
  heroGlow: {
    position: 'absolute',
    top: -70,
    right: -50,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: colors.green,
    opacity: 0.35,
  },
  heroGlowSmall: {
    position: 'absolute',
    bottom: -40,
    left: 120,
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: colors.purple,
    opacity: 0.25,
  },
  heroKicker: { fontSize: 13, fontWeight: '700', color: colors.green },
  heroTitle: { fontSize: 30, fontWeight: '800', color: '#ffffff' },
  heroText: { fontSize: 15, color: '#ffffffb3' },
  highlights: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  highlight: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#ffffff1f',
  },
  highlightText: { fontSize: 13, fontWeight: '600', color: '#ffffff' },
  separator: { height: 1, marginLeft: 66, backgroundColor: colors.separator },
})
</script>

<template>
  <Page>
    <Stack.Screen :options="{ title: 'Explore', headerShown: false }" />

    <View :style="styles.brand">
      <Image :source="logo" resize-mode="contain" :style="styles.logo" />
      <Text :style="styles.brandName">Vue Native</Text>
      <View :style="styles.platforms">
        <Text :style="styles.platformsText">iOS · Android</Text>
      </View>
    </View>

    <View :style="styles.hero">
      <View :style="styles.heroGlow" />
      <View :style="styles.heroGlowSmall" />
      <Text :style="styles.heroKicker">SHOWCASE</Text>
      <Text :style="styles.heroTitle">What will you build today?</Text>
      <Text :style="styles.heroText">
        Every demo renders real native views from a Vue template. Pick one and peek at its source in
        src/app/(tabs)/explore.
      </Text>
      <View :style="styles.highlights">
        <View v-for="highlight in HIGHLIGHTS" :key="highlight" :style="styles.highlight">
          <Text :style="styles.highlightText">{{ highlight }}</Text>
        </View>
      </View>
    </View>

    <Section v-for="section in demoSections" :key="section.title" :title="section.title" flush>
      <template v-for="(demo, index) in section.demos" :key="demo.href">
        <View v-if="index > 0" :style="styles.separator" />
        <DemoRow :demo="demo" />
      </template>
    </Section>
  </Page>
</template>
