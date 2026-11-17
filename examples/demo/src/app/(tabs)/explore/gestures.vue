<script setup lang="ts">
import {
  Animated,
  StyleSheet,
  type GestureState,
  type PanEvent,
  type PinchEvent,
  type RotateEvent,
} from 'vue'
import { Stack } from 'vuenative/router'

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

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 24, alignItems: 'center' },
  hint: { fontSize: 15, color: '#8e8e93', textAlign: 'center' },
  card: {
    width: 180,
    height: 180,
    marginTop: 80,
    borderRadius: 32,
    backgroundColor: '#42b883',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardText: { color: '#ffffff', fontSize: 22, fontWeight: 'bold' },
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
    <Stack.Screen :options="{ title: 'Gestos' }" />
    <Text :style="styles.hint">Arraste, faça pinça ou gire com dois dedos.</Text>

    <View
      :style="{ ...styles.card, transform: cardTransform }"
      :on-pan="handlePan"
      :on-pinch="handlePinch"
      :on-rotate="handleRotate"
    >
      <Text :style="styles.cardText">Vue</Text>
    </View>
  </View>
</template>
