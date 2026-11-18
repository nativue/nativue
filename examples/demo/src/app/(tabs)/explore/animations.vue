<script setup lang="ts">
import {
  Animated,
  computed,
  Dimensions,
  LayoutAnimation,
  onMounted,
  onUnmounted,
  ref,
  type Style,
  StyleSheet,
} from 'vue'
import { Stack } from '@nativue/core/router'
import Page from '@/components/Page.vue'
import PrimaryButton from '@/components/PrimaryButton.vue'
import Section from '@/components/Section.vue'
import { colors, radius, spacing } from '@/lib/theme'

type PresetName = keyof typeof LayoutAnimation.Presets

const HEADER_FADE_DISTANCE = 160
const BALL_SIZE = 44
const PRESET_LABELS: Record<PresetName, string> = {
  easeInEaseOut: 'Ease',
  linear: 'Linear',
  spring: 'Spring',
}
const PRESET_NAMES = Object.keys(PRESET_LABELS) as PresetName[]

// The page's padding and the card's, on both sides.
const trackWidth = Dimensions.get('window').width - 2 * spacing.large - 2 * spacing.medium
const ballTravel = trackWidth - BALL_SIZE

const scrollY = new Animated.Value(0)
const spin = new Animated.Value(0)
const pulse = new Animated.Value(0)
const ballPosition = new Animated.Value(0)

const loops = [
  Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1100, easing: 'linear' })),
  Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1400 })),
]

const ballAtEnd = ref(false)
const expanded = ref(false)
const presetName = ref<PresetName>('spring')

const handleScroll = Animated.event({ y: scrollY })

// The banner fades and sinks as the page scrolls, and grows when pulled down.
const bannerMotion = {
  opacity: scrollY.interpolate({
    inputRange: [0, HEADER_FADE_DISTANCE],
    outputRange: [1, 0.2],
    extrapolate: 'clamp',
  }),
  transform: [
    {
      translateY: scrollY.interpolate({
        inputRange: [0, HEADER_FADE_DISTANCE],
        outputRange: [0, 50],
        extrapolate: 'clamp',
      }),
    },
    {
      scale: scrollY.interpolate({
        inputRange: [-150, 0],
        outputRange: [1.25, 1],
        extrapolate: 'clamp',
      }),
    },
  ],
}
const spinTransform = [
  { rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
]
const pulseMotion = {
  opacity: pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.4, 1] }),
  transform: [{ scale: pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.5, 1] }) }],
}
const ballTransform = [{ translateX: ballPosition }]

const styles = computed(() =>
  StyleSheet.create({
    banner: {
      height: 150,
      borderRadius: radius.large,
      backgroundColor: colors.purple,
      justifyContent: 'center',
      alignItems: 'center',
      gap: 4,
    },
    bannerTitle: { color: '#ffffff', fontSize: 26, fontWeight: '800' },
    bannerText: { color: '#ffffffcc', fontSize: 15, fontWeight: '500' },
    loops: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      alignItems: 'center',
      height: 80,
    },
    spinner: {
      width: 52,
      height: 52,
      borderRadius: 26,
      borderWidth: 5,
      borderColor: colors.purple,
      alignItems: 'center',
    },
    spinnerMark: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.text },
    pulse: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.pink },
    track: { height: BALL_SIZE, borderRadius: BALL_SIZE / 2, backgroundColor: colors.background },
    ball: {
      width: BALL_SIZE,
      height: BALL_SIZE,
      borderRadius: BALL_SIZE / 2,
      backgroundColor: colors.purple,
    },
    buttons: { flexDirection: 'row', gap: 12 },
    button: { flex: 1 },
    presets: { flexDirection: 'row', gap: 8 },
    presetText: { fontSize: 14, fontWeight: '600' },
    panelTitle: { color: '#ffffff', fontSize: 20, fontWeight: '800' },
    panelText: { color: '#ffffffcc', fontSize: 15 },
  }),
)

function presetStyle(name: PresetName): Style {
  const selected = name === presetName.value

  return {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.small,
    alignItems: 'center',
    backgroundColor: selected ? colors.ink : colors.background,
  }
}

function panelStyle(): Style {
  return {
    height: expanded.value ? 180 : 72,
    padding: spacing.medium,
    gap: 6,
    borderRadius: radius.medium,
    backgroundColor: expanded.value ? colors.green : colors.ink,
    justifyContent: 'center',
  }
}

function moveBall(animation: 'timing' | 'spring') {
  const toValue = ballAtEnd.value ? 0 : ballTravel
  ballAtEnd.value = !ballAtEnd.value

  if (animation === 'timing') Animated.timing(ballPosition, { toValue, duration: 600 }).start()
  else Animated.spring(ballPosition, { toValue, damping: 12 }).start()
}

function togglePanel() {
  LayoutAnimation.configureNext(LayoutAnimation.Presets[presetName.value])
  expanded.value = !expanded.value
}

onMounted(() => loops.forEach((loop) => loop.start()))
onUnmounted(() => loops.forEach((loop) => loop.stop())) // native would keep running them
</script>

<template>
  <Page :on-scroll="handleScroll">
    <Stack.Screen :options="{ title: 'Animations' }" />

    <View :style="{ ...styles.banner, ...bannerMotion }">
      <Text :style="styles.bannerTitle">Scroll me</Text>
      <Text :style="styles.bannerText">or pull down</Text>
    </View>

    <Section title="Loops" footer="Animated.loop runs forever on the native side.">
      <View :style="styles.loops">
        <View :style="{ ...styles.spinner, transform: spinTransform }">
          <View :style="styles.spinnerMark" />
        </View>
        <View :style="{ ...styles.pulse, ...pulseMotion }" />
      </View>
    </Section>

    <Section title="Timing and spring">
      <View :style="styles.track">
        <View :style="{ ...styles.ball, transform: ballTransform }" />
      </View>
      <View :style="styles.buttons">
        <View :style="styles.button">
          <PrimaryButton title="Timing" :tint="colors.ink" @press="moveBall('timing')" />
        </View>
        <View :style="styles.button">
          <PrimaryButton title="Spring" :tint="colors.purple" @press="moveBall('spring')" />
        </View>
      </View>
    </Section>

    <Section
      title="LayoutAnimation"
      footer="One call before changing state animates the size and color change."
    >
      <View :style="styles.presets">
        <Pressable
          v-for="name in PRESET_NAMES"
          :key="name"
          :style="presetStyle(name)"
          @press="presetName = name"
        >
          <Text
            :style="{ ...styles.presetText, color: name === presetName ? '#ffffff' : colors.text }"
          >
            {{ PRESET_LABELS[name] }}
          </Text>
        </Pressable>
      </View>
      <Pressable :style="panelStyle()" @press="togglePanel">
        <Text :style="styles.panelTitle">{{ expanded ? 'Expanded' : 'Tap to expand' }}</Text>
        <Text v-if="expanded" :style="styles.panelText">Tap again to collapse.</Text>
      </Pressable>
    </Section>
  </Page>
</template>
