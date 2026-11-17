// The catalog shown on the Explore tab: one entry per page in app/(tabs)/explore.
import type { Component } from 'vue'
import {
  BlocksIcon,
  CompassIcon,
  DatabaseIcon,
  HandIcon,
  ListChecksIcon,
  SparklesIcon,
} from 'vuenative-icons/lucide'
import { colors } from './theme'

export interface Demo {
  href: string
  title: string
  subtitle: string
  icon: Component
  tint: string
}

export interface DemoSection {
  title: string
  demos: Demo[]
}

export const demoSections: DemoSection[] = [
  {
    title: 'Building blocks',
    demos: [
      {
        href: '/explore/components',
        title: 'Components',
        subtitle: 'Text, buttons, inputs, icons, images and sheets',
        icon: BlocksIcon,
        tint: colors.blue,
      },
      {
        href: '/explore/list',
        title: 'Lists',
        subtitle: '1,000 virtualized rows with swipe actions',
        icon: ListChecksIcon,
        tint: colors.orange,
      },
    ],
  },
  {
    title: 'Motion',
    demos: [
      {
        href: '/explore/animations',
        title: 'Animations',
        subtitle: 'Animated on the native driver, LayoutAnimation',
        icon: SparklesIcon,
        tint: colors.purple,
      },
      {
        href: '/explore/gestures',
        title: 'Gestures',
        subtitle: 'Pan, pinch and rotate without touching JS',
        icon: HandIcon,
        tint: colors.pink,
      },
    ],
  },
  {
    title: 'App essentials',
    demos: [
      {
        href: '/explore/navigation',
        title: 'Navigation',
        subtitle: 'Stacks, modals, deep links and focus',
        icon: CompassIcon,
        tint: colors.green,
      },
      {
        href: '/explore/data',
        title: 'Data',
        subtitle: 'fetch, AsyncStorage and timers',
        icon: DatabaseIcon,
        tint: colors.teal,
      },
    ],
  },
]
