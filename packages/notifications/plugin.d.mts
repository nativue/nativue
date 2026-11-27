import type { NativuePlugin } from '@nativue/core/config'

export interface NotificationsOptions {
  /** Android: on time instead of within minutes; adds SCHEDULE_EXACT_ALARM, which the user allows. */
  exactAlarms?: boolean
  /** Android: the small icon, a white shape on transparent PNG, relative to the app. */
  icon?: string
  /** Android: the small icon's tint, e.g. '#10B39B'. */
  iconColor?: string
  /** Notification sounds, .wav files relative to the app, played by their file name: schedule({ sound: 'chime.wav' }). */
  sounds?: string[]
}

export default function notifications(options?: NotificationsOptions): NativuePlugin
