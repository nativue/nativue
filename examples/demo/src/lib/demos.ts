// The catalog shown on the Explore tab: one entry per page in app/(tabs)/explore.
import type { Component } from 'vue'
import {
  BellIcon,
  BlendIcon,
  BlocksIcon,
  BugIcon,
  ChartSplineIcon,
  ClipboardCopyIcon,
  CompassIcon,
  DatabaseIcon,
  FolderOpenIcon,
  HandIcon,
  HardDriveIcon,
  ImagesIcon,
  KeyRoundIcon,
  ListChecksIcon,
  LogInIcon,
  PaletteIcon,
  ScanFaceIcon,
  Share2Icon,
  SparklesIcon,
  SquareTerminalIcon,
  VibrateIcon,
  WifiIcon,
} from '@nativue/icons/lucide'
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
    title: 'UI',
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
      {
        href: '/explore/gradients',
        title: 'Gradients',
        subtitle: 'linear-gradient() and radial-gradient() backgrounds',
        icon: BlendIcon,
        tint: colors.pink,
      },
      {
        href: '/explore/svg',
        title: 'Svg',
        subtitle: 'Charts and drawings with <svg>, tappable',
        icon: ChartSplineIcon,
        tint: colors.green,
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
    title: 'App',
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
      {
        href: '/explore/errors',
        title: 'Errors',
        subtitle: 'The error screen of development builds',
        icon: BugIcon,
        tint: colors.red,
      },
      {
        href: '/explore/console',
        title: 'Console',
        subtitle: 'log, warn, table and more, in the dev server terminal',
        icon: SquareTerminalIcon,
        tint: colors.ink,
      },
    ],
  },
  {
    title: 'Packages',
    demos: [
      {
        href: '/explore/tailwind',
        title: 'Tailwind',
        subtitle: 'Utility classes: @nativue/tailwind',
        icon: PaletteIcon,
        tint: colors.teal,
      },
      {
        href: '/explore/haptics',
        title: 'Haptics',
        subtitle: 'Haptic feedback, with native code: @nativue/haptics',
        icon: VibrateIcon,
        tint: colors.red,
      },
      {
        href: '/explore/auth-session',
        title: 'Auth session',
        subtitle: 'OAuth sign-in in the secure browser: @nativue/auth-session',
        icon: LogInIcon,
        tint: colors.blue,
      },
      {
        href: '/explore/biometrics',
        title: 'Biometrics',
        subtitle: 'Face ID, Touch ID and fingerprint: @nativue/biometrics',
        icon: ScanFaceIcon,
        tint: colors.purple,
      },
      {
        href: '/explore/clipboard',
        title: 'Clipboard',
        subtitle: 'Copy text, with native code: @nativue/clipboard',
        icon: ClipboardCopyIcon,
        tint: colors.purple,
      },
      {
        href: '/explore/file-system',
        title: 'File system',
        subtitle: 'Read, write, download and upload files: @nativue/file-system',
        icon: FolderOpenIcon,
        tint: colors.teal,
      },
      {
        href: '/explore/image-picker',
        title: 'Image picker',
        subtitle: 'Photos, videos and the camera: @nativue/image-picker',
        icon: ImagesIcon,
        tint: colors.pink,
      },
      {
        href: '/explore/network',
        title: 'Network',
        subtitle: 'Online or offline, live: @nativue/network',
        icon: WifiIcon,
        tint: colors.blue,
      },
      {
        href: '/explore/secure-store',
        title: 'Secure store',
        subtitle: 'Secrets in the Keychain and the Keystore: @nativue/secure-store',
        icon: KeyRoundIcon,
        tint: colors.orange,
      },
      {
        href: '/explore/notifications',
        title: 'Notifications',
        subtitle: 'Local notifications, with native code: @nativue/notifications',
        icon: BellIcon,
        tint: colors.orange,
      },
      {
        href: '/explore/share',
        title: 'Share',
        subtitle: 'Text, links, photos and files: @nativue/share',
        icon: Share2Icon,
        tint: colors.green,
      },
      {
        href: '/explore/sqlite',
        title: 'SQLite',
        subtitle: 'Todos kept in a database: @nativue/sqlite',
        icon: HardDriveIcon,
        tint: colors.blue,
      },
    ],
  },
]
