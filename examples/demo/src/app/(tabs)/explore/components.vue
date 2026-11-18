<script setup lang="ts">
import { computed, Keyboard, ref, StyleSheet } from 'vue'
import {
  BellIcon,
  CameraIcon,
  HeartIcon,
  LayersIcon,
  MessageCircleIcon,
  SettingsIcon,
  StarIcon,
} from '@nativue/icons/lucide'
import { Stack } from '@nativue/core/router'
import logo from '@/assets/logo-mark.png'
import FieldRow from '@/components/FieldRow.vue'
import Page from '@/components/Page.vue'
import PrimaryButton from '@/components/PrimaryButton.vue'
import Section from '@/components/Section.vue'
import { colors, radius, spacing } from '@/lib/theme'

const REMOTE_IMAGE_URL = 'https://picsum.photos/id/1018/800/400'

// Color names, so the icons follow the color scheme.
const COLORED_ICONS = [
  { icon: HeartIcon, color: 'red' },
  { icon: StarIcon, color: 'orange' },
  { icon: BellIcon, color: 'blue' },
  { icon: CameraIcon, color: 'text' },
  { icon: MessageCircleIcon, color: 'green' },
  { icon: SettingsIcon, color: 'purple' },
] as const
const STROKE_WIDTHS = [1, 1.5, 2, 2.5, 3]

const name = ref('')
const notifications = ref(true)
const tapCount = ref(0)
const sheetVisible = ref(false)

const styles = computed(() =>
  StyleSheet.create({
    largeTitle: { fontSize: 34, fontWeight: '800', color: colors.text },
    title: { fontSize: 22, fontWeight: '600', color: colors.text },
    body: { fontSize: 17, color: colors.text },
    caption: { fontSize: 13, color: colors.secondaryText },
    accent: { fontSize: 17, fontWeight: '600', color: colors.green },
    pressable: {
      padding: spacing.medium,
      borderRadius: radius.small,
      borderWidth: 2,
      borderColor: colors.green,
      alignItems: 'center',
    },
    pressablePressed: { backgroundColor: colors.greenSoft, transform: [{ scale: 0.97 }] },
    input: {
      height: 48,
      paddingHorizontal: 14,
      borderRadius: radius.small,
      borderWidth: 2,
      borderColor: 'transparent',
      backgroundColor: colors.background,
      fontSize: 17,
    },
    inputFocused: { borderColor: colors.green },
    iconRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    indicators: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
    images: { flexDirection: 'row', gap: 12 },
    localImage: {
      width: 96,
      height: 96,
      padding: 16,
      borderRadius: radius.small,
      backgroundColor: colors.background,
    },
    remoteImage: { flex: 1, height: 96, borderRadius: radius.small },
    cover: {
      height: 140,
      justifyContent: 'flex-end',
      padding: spacing.medium,
      borderRadius: radius.small,
      overflow: 'hidden',
    },
    coverTitle: { fontSize: 22, fontWeight: '700', color: '#ffffff' },
    sheet: { flex: 1, padding: spacing.large, gap: spacing.medium },
    sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  }),
)
</script>

<template>
  <Page>
    <Stack.Screen :options="{ title: 'Components' }" />

    <Section title="Text">
      <Text :style="styles.largeTitle">Large title</Text>
      <Text :style="styles.title">Title</Text>
      <Text :style="styles.body">
        Body text wraps onto as many lines as it needs, like a native label.
      </Text>
      <Text :style="styles.caption">Caption</Text>
    </Section>

    <Section title="Buttons" :footer="`Tapped ${tapCount} times`">
      <PrimaryButton title="Primary button" @press="tapCount++" />
      <Pressable
        v-slot="{ pressed }"
        :style="styles.pressable"
        :pressed-style="styles.pressablePressed"
        @press="tapCount++"
      >
        <Text :style="styles.accent">{{ pressed ? 'Pressing…' : 'Custom Pressable' }}</Text>
      </Pressable>
      <Button title="System button" @press="tapCount++" />
    </Section>

    <Section title="Inputs">
      <TextInput
        v-model.trim="name"
        placeholder="Your name"
        :style="styles.input"
        :focused-style="styles.inputFocused"
      />
      <Text :style="styles.body">Hello, {{ name || 'stranger' }} 👋</Text>
      <FieldRow label="Notifications" :detail="notifications ? 'On' : 'Off'">
        <Switch v-model="notifications" />
      </FieldRow>
      <Button title="Dismiss keyboard" @press="Keyboard.dismiss()" />
    </Section>

    <Section title="Icons" footer="2,000+ Lucide icons from @nativue/icons, drawn natively.">
      <View :style="styles.iconRow">
        <component
          :is="coloredIcon.icon"
          v-for="coloredIcon in COLORED_ICONS"
          :key="coloredIcon.color"
          :size="28"
          :color="colors[coloredIcon.color]"
        />
      </View>
      <View :style="styles.iconRow">
        <LayersIcon
          v-for="strokeWidth in STROKE_WIDTHS"
          :key="strokeWidth"
          :size="32"
          :color="colors.text"
          :stroke-width="strokeWidth"
        />
      </View>
    </Section>

    <Section title="Activity">
      <View :style="styles.indicators">
        <ActivityIndicator />
        <ActivityIndicator size="large" :color="colors.green" />
      </View>
    </Section>

    <Section
      title="Images"
      footer="A bundled asset, an image loaded over the network, and text over a photo."
    >
      <View :style="styles.images">
        <Image :source="logo" alt="nativue logo" resize-mode="contain" :style="styles.localImage" />
        <Image
          :source="{ uri: REMOTE_IMAGE_URL }"
          alt="A lake among mountains"
          :style="styles.remoteImage"
        />
      </View>
      <ImageBackground :source="{ uri: REMOTE_IMAGE_URL }" :style="styles.cover">
        <Text :style="styles.coverTitle">Text over a photo</Text>
      </ImageBackground>
    </Section>

    <Section title="Sheets">
      <PrimaryButton title="Present a sheet" :tint="colors.ink" @press="sheetVisible = true" />
    </Section>

    <Modal
      :visible="sheetVisible"
      animation-type="slide"
      presentation-style="pageSheet"
      @request-close="sheetVisible = false"
    >
      <View :style="styles.sheet">
        <View :style="styles.sheetHeader">
          <Text :style="styles.title">A native sheet</Text>
          <Button title="Done" @press="sheetVisible = false" />
        </View>
        <Text :style="styles.body">
          Rendered by &lt;Modal&gt;, driven by a ref. Swipe it down to dismiss.
        </Text>
      </View>
    </Modal>
  </Page>
</template>
