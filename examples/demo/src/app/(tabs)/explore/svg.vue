<script setup lang="ts">
import { computed, ref } from 'vue'
import { Stack } from '@nativue/core/router'
import Page from '@/components/Page.vue'
import Section from '@/components/Section.vue'
import { colors } from '@/lib/theme'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WIDTH = 300
const HEIGHT = 150
const PADDING = 20

// The ring's circumference: dash offset 0 draws all of it.
const RING = 2 * Math.PI * 30

const progress = ref(0.75)
const steps = ref([4200, 7600, 5100, 9800, 6400, 11200, 8300])
const selected = ref(steps.value.length - 1)

const points = computed(() => {
  const highest = Math.max(...steps.value)

  return steps.value.map((value, index) => ({
    x: PADDING + (index * (WIDTH - PADDING * 2)) / (steps.value.length - 1),
    y: HEIGHT - PADDING - (value / highest) * (HEIGHT - PADDING * 2),
  }))
})
const line = computed(() =>
  points.value.map(({ x, y }, index) => `${index ? 'L' : 'M'}${x} ${y}`).join(' '),
)
const area = computed(() => {
  const last = points.value[points.value.length - 1]

  return `${line.value} L${last.x} ${HEIGHT - PADDING} L${PADDING} ${HEIGHT - PADDING} Z`
})

function shuffle() {
  steps.value = steps.value.map(() => 3000 + Math.round(Math.random() * 9000))
}
</script>

<template>
  <Page>
    <Stack.Screen :options="{ title: 'Svg' }" />

    <Section title="Chart" footer="<svg> as on the web: tap a point. Drawn by one native view.">
      <View class="items-center rounded-xl bg-white py-3 dark:bg-slate-800">
        <svg :viewBox="`0 0 ${WIDTH} ${HEIGHT + 20}`" width="320" height="180">
          <defs>
            <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" :stop-color="colors.green" stop-opacity="0.45" />
              <stop offset="100%" :stop-color="colors.green" stop-opacity="0" />
            </linearGradient>
          </defs>
          <line
            :x1="PADDING"
            :y1="HEIGHT - PADDING"
            :x2="WIDTH - PADDING"
            :y2="HEIGHT - PADDING"
            stroke="#94a3b8"
            stroke-dasharray="4 4"
          />
          <path :d="area" fill="url(#area)" />
          <path
            :d="line"
            fill="none"
            :stroke="colors.green"
            stroke-width="3"
            stroke-linejoin="round"
          />
          <g v-for="(point, index) in points" :key="index">
            <circle
              :cx="point.x"
              :cy="point.y"
              :r="selected === index ? 7 : 4.5"
              :fill="selected === index ? colors.green : 'white'"
              :stroke="colors.green"
              stroke-width="2.5"
              @press="selected = index"
            />
            <text :x="point.x" :y="HEIGHT + 4" text-anchor="middle" font-size="11" fill="#64748b">
              {{ DAYS[index] }}
            </text>
          </g>
          <text
            :x="WIDTH / 2"
            y="14"
            text-anchor="middle"
            font-size="13"
            font-weight="bold"
            fill="#0f172a"
          >
            {{ DAYS[selected] }}: {{ steps[selected].toLocaleString() }} steps
          </text>
        </svg>
      </View>
      <Pressable
        class="items-center rounded-xl bg-white py-3 active:bg-slate-200 dark:bg-slate-800 dark:active:bg-slate-700"
        @press="shuffle"
      >
        <Text class="font-semibold text-slate-900 dark:text-white">New week</Text>
      </Pressable>
    </Section>

    <Section
      title="Effects"
      footer="clipPath, mask, use, symbol, feDropShadow, tspan and dash offset."
    >
      <View class="items-center rounded-xl bg-white py-4 dark:bg-slate-800">
        <svg viewBox="0 0 300 120" width="320" height="128">
          <defs>
            <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#4AF2AE" />
              <stop offset="1" stop-color="#10B39B" />
            </linearGradient>
            <linearGradient id="brandAcross" href="#brand" y2="0" />
            <clipPath id="avatar"><circle cx="40" cy="40" r="32" /></clipPath>
            <symbol id="star" viewBox="0 0 24 24">
              <path d="M12 2l3 7h7l-6 4 2 7-6-4-6 4 2-7-6-4h7z" />
            </symbol>
            <filter id="lift">
              <feDropShadow
                dx="0"
                dy="3"
                stdDeviation="3"
                flood-color="#0B1220"
                flood-opacity="0.3"
              />
            </filter>
          </defs>
          <rect x="8" y="8" width="64" height="64" fill="url(#brand)" clip-path="url(#avatar)" />
          <use
            v-for="index in 3"
            :key="index"
            href="#star"
            :x="(index - 1) * 26 + 4"
            y="84"
            width="22"
            height="22"
            fill="#ffd60a"
          />
          <circle cx="130" cy="44" r="30" fill="none" stroke="#e2e8f0" stroke-width="8" />
          <circle
            cx="130"
            cy="44"
            r="30"
            fill="none"
            stroke="#0E9F84"
            stroke-width="8"
            stroke-linecap="round"
            :stroke-dasharray="RING"
            :stroke-dashoffset="RING * (1 - progress)"
            transform="rotate(-90 130 44)"
          />
          <rect x="185" y="14" width="105" height="60" rx="10" fill="white" filter="url(#lift)" />
          <text x="196" y="38" font-size="13" font-weight="bold" fill="#0f172a">
            {{ Math.round(progress * 100) }}% done
            <tspan x="196" dy="18" font-size="11" font-weight="normal" fill="#64748b">
              of today's goal
            </tspan>
          </text>
        </svg>
      </View>
      <Pressable
        class="items-center rounded-xl bg-white py-3 active:bg-slate-200 dark:bg-slate-800 dark:active:bg-slate-700"
        @press="progress = progress >= 1 ? 0.25 : progress + 0.25"
      >
        <Text class="font-semibold text-slate-900 dark:text-white">More progress</Text>
      </Pressable>
    </Section>

    <Section
      title="Components"
      footer="<Svg>, <Circle>, <Path>... draw the same as the lowercase tags."
    >
      <View class="items-center rounded-xl bg-white py-4 dark:bg-slate-800">
        <Svg viewBox="0 0 120 60" width="240" height="120">
          <Defs>
            <RadialGradient id="sun" cx="0.5" cy="0.5" r="0.5">
              <Stop offset="0" stop-color="#ffd60a" />
              <Stop offset="1" stop-color="#ff9500" />
            </RadialGradient>
          </Defs>
          <Circle cx="34" cy="28" r="16" fill="url(#sun)" />
          <Path
            d="M8 52 Q34 30 60 52 T112 52"
            fill="none"
            stroke="#10B39B"
            stroke-width="4"
            stroke-linecap="round"
          />
          <G transform="translate(80 14) rotate(15)" opacity="0.85">
            <Rect width="24" height="12" rx="6" style="fill: #94a3b8" />
          </G>
        </Svg>
      </View>
    </Section>
  </Page>
</template>
