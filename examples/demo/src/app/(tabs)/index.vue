<!-- Onboarding: three pages swiped natively; their content and the dots follow the scroll on the
     native driver (no JS per frame). -->
<script setup lang="ts">
import {
  Animated,
  computed,
  Dimensions,
  onMounted,
  onUnmounted,
  StyleSheet,
  useColorScheme,
} from 'vue'
import {
  CodeIcon,
  DatabaseIcon,
  FlameIcon,
  GlobeIcon,
  HandIcon,
  PanelsTopLeftIcon,
  RouteIcon,
  RulerIcon,
  SmartphoneIcon,
  SparklesIcon,
  ZapIcon,
} from '@nativue/icons/lucide'
import { useRouter } from '@nativue/core/router'
import logo from '@/assets/logo-mark.png'
import logoDark from '@/assets/logo-mark-dark.png'
import IconTile from '@/components/IconTile.vue'
import PrimaryButton from '@/components/PrimaryButton.vue'
import { cardShadow, colors, radius, spacing } from '@/lib/theme'

const colorScheme = useColorScheme()

const PAGE_COUNT = 3

const FEATURES = [
  {
    icon: SmartphoneIcon,
    tint: colors.blue,
    title: 'Real native views',
    text: 'No web view, no DOM.',
  },
  {
    icon: RulerIcon,
    tint: colors.orange,
    title: 'Yoga flexbox',
    text: 'The flexbox you know from CSS.',
  },
  {
    icon: ZapIcon,
    tint: colors.purple,
    title: 'Native driver',
    text: 'Animations off the JS thread.',
  },
]

const CAPABILITIES = [
  { icon: RouteIcon, label: 'File-based router' },
  { icon: PanelsTopLeftIcon, label: 'Tabs & stacks' },
  { icon: SparklesIcon, label: 'Animated' },
  { icon: HandIcon, label: 'Gestures' },
  { icon: DatabaseIcon, label: 'AsyncStorage' },
  { icon: GlobeIcon, label: 'fetch' },
  { icon: CodeIcon, label: 'TypeScript' },
  { icon: FlameIcon, label: 'Hot reload' },
  { icon: SmartphoneIcon, label: 'iOS & Android' },
]

const router = useRouter()
const { width: pageWidth } = Dimensions.get('window')

const scrollX = new Animated.Value(0)
const float = new Animated.Value(0)
const floatLoop = Animated.loop(Animated.timing(float, { toValue: 1, duration: 3200 }))

const handleScroll = Animated.event({ x: scrollX })

const logoFloat = [
  { translateY: float.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -14, 0] }) },
  { rotate: float.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['0deg', '4deg', '0deg'] }) },
]

// Input range around page `index`: before it, on it, after it.
function aroundPage(index: number) {
  return [(index - 1) * pageWidth, index * pageWidth, (index + 1) * pageWidth]
}

// The content slides slower than the page and fades at the edges: a parallax.
function parallaxStyle(index: number) {
  const inputRange = aroundPage(index)

  return {
    opacity: scrollX.interpolate({ inputRange, outputRange: [0, 1, 0], extrapolate: 'clamp' }),
    transform: [
      {
        translateX: scrollX.interpolate({
          inputRange,
          outputRange: [pageWidth * 0.35, 0, -pageWidth * 0.35],
          extrapolate: 'clamp',
        }),
      },
    ],
  }
}

function dotStyle(index: number) {
  const inputRange = aroundPage(index)

  return {
    opacity: scrollX.interpolate({
      inputRange,
      outputRange: [0.25, 1, 0.25],
      extrapolate: 'clamp',
    }),
    transform: [
      {
        scale: scrollX.interpolate({ inputRange, outputRange: [1, 1.5, 1], extrapolate: 'clamp' }),
      },
    ],
  }
}

const pageParallax = Array.from({ length: PAGE_COUNT }, (_, index) => parallaxStyle(index))
const dots = Array.from({ length: PAGE_COUNT }, (_, index) => dotStyle(index))

const styles = computed(() =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface },
    glowTop: {
      position: 'absolute',
      top: -120,
      right: -120,
      width: 320,
      height: 320,
      borderRadius: 160,
      backgroundColor: colors.greenSoft,
    },
    glowBottom: {
      position: 'absolute',
      bottom: 80,
      left: -140,
      width: 280,
      height: 280,
      borderRadius: 140,
      backgroundColor: colors.inkSoft,
    },
    pager: { flex: 1 },
    page: { paddingHorizontal: 32, justifyContent: 'center' },
    pageContent: { gap: spacing.large },
    kicker: { fontSize: 13, fontWeight: '700', color: colors.green },
    title: { fontSize: 38, fontWeight: '800', color: colors.text },
    body: { fontSize: 18, color: colors.secondaryText },
    logoHalo: {
      width: 168,
      height: 168,
      borderRadius: 84,
      backgroundColor: colors.greenSoft,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: spacing.medium,
    },
    logoCore: {
      width: 120,
      height: 120,
      borderRadius: 60,
      backgroundColor: colors.surface,
      justifyContent: 'center',
      alignItems: 'center',
      ...cardShadow,
    },
    logo: { width: 84, height: 84 },
    featureCard: {
      padding: spacing.medium,
      gap: spacing.medium,
      borderRadius: radius.large,
      backgroundColor: colors.surface,
      ...cardShadow,
    },
    feature: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    featureTexts: { flex: 1, gap: 2 },
    featureTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
    featureText: { fontSize: 15, color: colors.secondaryText },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 20,
      backgroundColor: colors.background,
    },
    chipText: { fontSize: 15, fontWeight: '500', color: colors.text },
    footer: { paddingHorizontal: 32, paddingBottom: spacing.large, gap: spacing.large },
    dots: { flexDirection: 'row', justifyContent: 'center', gap: 12 },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.green },
  }),
)

onMounted(() => floatLoop.start())
onUnmounted(() => floatLoop.stop())
</script>

<template>
  <SafeAreaView :style="styles.screen">
    <View :style="styles.glowTop" />
    <View :style="styles.glowBottom" />

    <ScrollView
      horizontal
      paging-enabled
      :shows-horizontal-scroll-indicator="false"
      :style="styles.pager"
      :on-scroll="handleScroll"
    >
      <View :style="{ ...styles.page, width: pageWidth }">
        <View :style="{ ...styles.pageContent, ...pageParallax[0] }">
          <View :style="{ ...styles.logoHalo, transform: logoFloat }">
            <View :style="styles.logoCore">
              <Image
                :source="colorScheme === 'dark' ? logoDark : logo"
                alt="nativue"
                resize-mode="contain"
                :style="styles.logo"
              />
            </View>
          </View>
          <Text :style="styles.kicker">WELCOME TO NATIVUE</Text>
          <Text :style="styles.title">Vue, but truly native.</Text>
          <Text :style="styles.body">
            Write the Vue you already know. Ship real native apps for iOS and Android.
          </Text>
        </View>
      </View>

      <View :style="{ ...styles.page, width: pageWidth }">
        <View :style="{ ...styles.pageContent, ...pageParallax[1] }">
          <Text :style="styles.kicker">FAST BY DEFAULT</Text>
          <Text :style="styles.title">Native, all the way down.</Text>
          <View :style="styles.featureCard">
            <View v-for="feature in FEATURES" :key="feature.title" :style="styles.feature">
              <IconTile :icon="feature.icon" :tint="feature.tint" :size="44" />
              <View :style="styles.featureTexts">
                <Text :style="styles.featureTitle">{{ feature.title }}</Text>
                <Text :style="styles.featureText">{{ feature.text }}</Text>
              </View>
            </View>
          </View>
        </View>
      </View>

      <View :style="{ ...styles.page, width: pageWidth }">
        <View :style="{ ...styles.pageContent, ...pageParallax[2] }">
          <Text :style="styles.kicker">BATTERIES INCLUDED</Text>
          <Text :style="styles.title">Everything an app needs.</Text>
          <View :style="styles.chips">
            <View v-for="capability in CAPABILITIES" :key="capability.label" :style="styles.chip">
              <component :is="capability.icon" :size="16" :color="colors.green" />
              <Text :style="styles.chipText">{{ capability.label }}</Text>
            </View>
          </View>
        </View>
      </View>
    </ScrollView>

    <View :style="styles.footer">
      <View :style="styles.dots">
        <View v-for="(dot, index) in dots" :key="index" :style="{ ...styles.dot, ...dot }" />
      </View>
      <PrimaryButton title="Start exploring" @press="router.navigate('/explore')" />
    </View>
  </SafeAreaView>
</template>
