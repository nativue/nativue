<script setup>
import { LayoutAnimation, computed, reactive } from 'vue'
import { Stack } from 'vuenative/router'

// The gesture's values while it lasts; released, the card springs back.
const gesture = reactive({ translationX: 0, translationY: 0, scale: 1, rotation: 0 })

const cardStyle = computed(() => ({
  ...styles.card,
  transform: [
    { translateX: gesture.translationX },
    { translateY: gesture.translationY },
    { scale: gesture.scale },
    { rotate: `${gesture.rotation}rad` },
  ],
}))

const styles = {
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
}

function isFinished(state) {
  return state === 'ended' || state === 'cancelled'
}

function springBack(...properties) {
  const restingValues = { translationX: 0, translationY: 0, scale: 1, rotation: 0 }

  LayoutAnimation.configureNext(LayoutAnimation.Presets.spring)
  for (const property of properties) gesture[property] = restingValues[property]
}

function handlePan(event) {
  if (isFinished(event.state)) return springBack('translationX', 'translationY')

  gesture.translationX = event.translationX
  gesture.translationY = event.translationY
}

function handlePinch(event) {
  if (isFinished(event.state)) return springBack('scale')

  gesture.scale = event.scale
}

function handleRotate(event) {
  if (isFinished(event.state)) return springBack('rotation')

  gesture.rotation = event.rotation
}
</script>

<template>
  <View :style="styles.screen">
    <Stack.Screen :options="{ title: 'Gestos' }" />
    <Text :style="styles.hint">Arraste, faça pinça ou gire com dois dedos.</Text>

    <View :style="cardStyle" @pan="handlePan" @pinch="handlePinch" @rotate="handleRotate">
      <Text :style="styles.cardText">Vue</Text>
    </View>
  </View>
</template>
