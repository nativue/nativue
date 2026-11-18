<script setup lang="ts">
import {
  Animated,
  StyleSheet,
  type GestureState,
  type PanEvent,
  type PinchEvent,
  type RotateEvent,
} from 'vue'
import { MoveIcon, RotateCwIcon, ZoomInIcon } from '@nativue/icons/lucide'
import { Stack } from '@nativue/core/router'
import { cardShadow, colors, radius, spacing } from '@/lib/theme'

// The gestures write these values natively, so the card follows the fingers without JS.
const translationX = new Animated.Value(0)
const translationY = new Animated.Value(0)
const scale = new Animated.Value(1)
const rotation = new Animated.Value(0)

const cardTransform = [
  { translateX: translationX },
  { translateY: translationY },
  { scale },
  { rotate: rotation },
]

const HINTS = [
  { icon: MoveIcon, label: 'Drag' },
  { icon: ZoomInIcon, label: 'Pinch' },
  { icon: RotateCwIcon, label: 'Rotate' },
]

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    padding: spacing.large,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 48,
  },
  card: {
    width: 200,
    height: 200,
    borderRadius: 44,
    backgroundColor: colors.green,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    ...cardShadow,
    shadowOpacity: 0.2,
  },
  cardTitle: { color: '#ffffff', fontSize: 34, fontWeight: '800' },
  cardText: { color: '#ffffffcc', fontSize: 15, fontWeight: '600' },
  hints: { flexDirection: 'row', gap: 10 },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.medium,
    backgroundColor: colors.surface,
  },
  hintText: { fontSize: 15, fontWeight: '500', color: colors.navy },
  footnote: { fontSize: 13, color: colors.secondaryText, textAlign: 'center' },
})

// Released, each value springs back to rest.
function springBackWhenReleased(values: Animated.Value[], restingValue: number) {
  return ({ state }: { state: GestureState }) => {
    if (state !== 'ended' && state !== 'cancelled') return

    for (const value of values) Animated.spring(value, { toValue: restingValue }).start()
  }
}

const handlePan = Animated.event<PanEvent>(
  { translationX, translationY },
  { listener: springBackWhenReleased([translationX, translationY], 0) },
)
const handlePinch = Animated.event<PinchEvent>(
  { scale },
  { listener: springBackWhenReleased([scale], 1) },
)
const handleRotate = Animated.event<RotateEvent>(
  { rotation },
  { listener: springBackWhenReleased([rotation], 0) },
)
</script>

<template>
  <View :style="styles.screen">
    <Stack.Screen :options="{ title: 'Gestures' }" />

    <View :style="styles.hints">
      <View v-for="hint in HINTS" :key="hint.label" :style="styles.hint">
        <component :is="hint.icon" :size="16" :color="colors.pink" />
        <Text :style="styles.hintText">{{ hint.label }}</Text>
      </View>
    </View>

    <View
      :style="{ ...styles.card, transform: cardTransform }"
      :on-pan="handlePan"
      :on-pinch="handlePinch"
      :on-rotate="handleRotate"
    >
      <Text :style="styles.cardTitle">Vue</Text>
      <Text :style="styles.cardText">try me</Text>
    </View>

    <Text :style="styles.footnote">
      Gestures write into Animated values on the native side: no JS runs while you move it.
    </Text>
  </View>
</template>
