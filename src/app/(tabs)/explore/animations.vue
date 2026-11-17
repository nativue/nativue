<script setup>
import { Animated, onMounted, onUnmounted } from 'vue'
import { Stack } from 'vuenative/router'

const HEADER_FADE_DISTANCE = 120

const spin = new Animated.Value(0)
const pulse = new Animated.Value(0)
const scrollY = new Animated.Value(0)

const loops = [
  Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1000, easing: 'linear' })),
  Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1200 })),
]

// The header fades and rises as the page scrolls, and grows when pulled down.
const headerStyle = {
  opacity: scrollY.interpolate({
    inputRange: [0, HEADER_FADE_DISTANCE],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  }),
  transform: [
    {
      translateY: scrollY.interpolate({
        inputRange: [0, HEADER_FADE_DISTANCE],
        outputRange: [0, 60],
        extrapolate: 'clamp',
      }),
    },
    {
      scale: scrollY.interpolate({
        inputRange: [-120, 0],
        outputRange: [1.3, 1],
        extrapolate: 'clamp',
      }),
    },
  ],
}
const spinnerTransform = [
  { rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
]
const pulseTransform = [
  { scale: pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.4, 1] }) },
]

const handleScroll = Animated.event({ y: scrollY })

const styles = {
  content: { padding: 24, gap: 32, alignItems: 'center' },
  header: {
    width: '100%',
    height: 160,
    borderRadius: 24,
    backgroundColor: '#42b883',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerText: { color: '#ffffff', fontSize: 24, fontWeight: 'bold' },
  row: { flexDirection: 'row', gap: 48, alignItems: 'center' },
  spinner: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 5,
    borderColor: '#42b883',
    backgroundColor: '#d8f3e6',
    alignItems: 'center',
  },
  spinnerMark: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#35495e' },
  pulse: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#ff3b30' },
  filler: { width: '100%', height: 90, borderRadius: 16, backgroundColor: '#f2f2f7' },
}

onMounted(() => loops.forEach((loop) => loop.start()))
onUnmounted(() => loops.forEach((loop) => loop.stop())) // native would keep running them
</script>

<template>
  <ScrollView :style="{ flex: 1 }" :on-scroll="handleScroll">
    <Stack.Screen :options="{ title: 'Animações' }" />

    <View :style="styles.content">
      <View :style="{ ...styles.header, ...headerStyle }">
        <Text :style="styles.headerText">Role a página</Text>
      </View>

      <View :style="styles.row">
        <View :style="{ ...styles.spinner, transform: spinnerTransform }">
          <View :style="styles.spinnerMark" />
        </View>
        <View :style="{ ...styles.pulse, transform: pulseTransform }" />
      </View>

      <View v-for="index in 8" :key="index" :style="styles.filler" />
    </View>
  </ScrollView>
</template>
