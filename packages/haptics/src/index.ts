// Haptic feedback: UIFeedbackGenerator on iOS, the system's haptic constants on Android. Both follow
// the user's system settings.
import { requireNativeFunction } from '@nativue/core'

export type ImpactStyle = 'light' | 'medium' | 'heavy'
export type NotificationType = 'success' | 'warning' | 'error'

const nativeImpact = requireNativeFunction<(style: ImpactStyle) => void>('haptics.impact')
const nativeNotification =
  requireNativeFunction<(type: NotificationType) => void>('haptics.notification')
const nativeSelection = requireNativeFunction<() => void>('haptics.selection')

//   Haptics.impact('heavy')         a tap of some weight, e.g. a drop
//   Haptics.notification('success') a task succeeded, needs attention, or failed
//   Haptics.selection()             a picker or segmented control moved
export const Haptics = {
  impact(style: ImpactStyle = 'medium'): void {
    nativeImpact(style)
  },

  notification(type: NotificationType = 'success'): void {
    nativeNotification(type)
  },

  selection(): void {
    nativeSelection()
  },
}
