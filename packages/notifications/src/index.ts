import {
  addNativeListener,
  getCurrentInstance,
  onUnmounted,
  type NativeSubscription,
  type PermissionResponseWith,
  requireNativeFunction,
} from '@nativue/core'

export type NotificationPermission = PermissionResponseWith<{
  /** iOS 12+: allowed quietly, to Notification Center only, until the user chooses. */
  provisional?: boolean
}>

export interface NotificationContent {
  title: string
  body?: string
  /** Comes back in onResponse and onReceived, e.g. { orderId: 42 }: what the app opens on a tap. */
  data?: Record<string, unknown>
  /** The system's sound. Defaults to true. */
  sound?: boolean
  /** Android: the channel it's posted to (setChannel). Defaults to "default". */
  channelId?: string
}

/**
 * When it shows: null now, in `seconds` (repeating every `seconds`, 60 or more, with `repeats`), at
 * a `date` (now if it passed), or every day at `hour`:`minute`, in the device's time zone.
 */
export type NotificationTrigger =
  | null
  | { seconds: number; repeats?: boolean }
  | { date: Date | number }
  | { hour: number; minute: number }

export interface Notification extends NotificationContent {
  id: string
}

export interface ScheduledNotification {
  id: string
  content: NotificationContent
  trigger: NotificationTrigger
}

export interface NotificationResponse {
  notification: Notification
}

export interface ForegroundPresentation {
  banner: boolean
  sound: boolean
}

export interface NotificationChannel {
  id: string
  /** Shown in the app's notification settings. */
  name: string
  description?: string
  /** high: heads-up banner and sound; default: sound; low: silent; min: silent, collapsed. */
  importance?: 'high' | 'default' | 'low' | 'min'
}

// Native gets data as JSON: any shape, without a type per platform.
type NativeNotification = Omit<Notification, 'data'> & { data: string | null }
type NativeTrigger =
  | null
  | { type: 'seconds'; seconds: number; repeats: boolean }
  | { type: 'date'; timestamp: number }
  | { type: 'daily'; hour: number; minute: number }
type NativeScheduled = {
  id: string
  content: Omit<NativeNotification, 'id'>
  trigger: NativeTrigger
}
// tapId: the same tap can reach both onResponse and getLastResponse.
type NativeResponse = { notification: NativeNotification; tapId: string }

const native = {
  getPermission: requireNativeFunction<() => Promise<NotificationPermission>>(
    'notifications.getPermission',
  ),
  requestPermission: requireNativeFunction<
    (options: { provisional: boolean }) => Promise<NotificationPermission>
  >('notifications.requestPermission'),
  schedule:
    requireNativeFunction<
      (notification: NativeNotification, trigger: NativeTrigger) => Promise<string>
    >('notifications.schedule'),
  cancel: requireNativeFunction<(id: string) => Promise<void>>('notifications.cancel'),
  cancelAll: requireNativeFunction<() => Promise<void>>('notifications.cancelAll'),
  getScheduled: requireNativeFunction<() => Promise<NativeScheduled[]>>(
    'notifications.getScheduled',
  ),
  getLastResponse: requireNativeFunction<() => Promise<NativeResponse | null>>(
    'notifications.getLastResponse',
  ),
  setForegroundPresentation: requireNativeFunction<(presentation: ForegroundPresentation) => void>(
    'notifications.setForegroundPresentation',
  ),
  setChannel: requireNativeFunction<(channel: Required<NotificationChannel>) => Promise<void>>(
    'notifications.setChannel',
  ),
  openSettings: requireNativeFunction<() => Promise<void>>('notifications.openSettings'),
}

let nextId = 0
const responseListeners = new Set<(response: NotificationResponse) => void>()
const handledTaps = new Set<string>()

addNativeListener<NativeResponse>('notifications.response', ({ notification, tapId }) => {
  if (responseListeners.size === 0) return

  handledTaps.add(tapId)
  for (const listener of [...responseListeners])
    listener({ notification: fromNative(notification) })
})

function nativeTrigger(trigger: NotificationTrigger): NativeTrigger {
  if (trigger === null) return null
  if ('seconds' in trigger) {
    const repeats = trigger.repeats ?? false

    if (trigger.seconds <= 0 || (repeats && trigger.seconds < 60)) {
      throw new RangeError('A trigger is more than 0 seconds away, and repeats every 60 or more')
    }

    return { type: 'seconds', seconds: trigger.seconds, repeats }
  }
  if ('date' in trigger) {
    const timestamp = new Date(trigger.date).getTime()

    if (Number.isNaN(timestamp)) throw new RangeError('The trigger date is invalid')

    // iOS counts whole seconds: a date less than one away would already be past, and never show.
    return timestamp - Date.now() < 1000 ? null : { type: 'date', timestamp }
  }

  const { hour, minute } = trigger

  if (
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59
  ) {
    throw new RangeError('A daily trigger is an hour from 0 to 23 and a minute from 0 to 59')
  }

  return { type: 'daily', hour, minute }
}

function fromNativeTrigger(trigger: NativeTrigger): NotificationTrigger {
  if (trigger === null) return null
  if (trigger.type === 'seconds') return { seconds: trigger.seconds, repeats: trigger.repeats }
  if (trigger.type === 'date') return { date: trigger.timestamp }

  return { hour: trigger.hour, minute: trigger.minute }
}

function fromNative<Shown extends Omit<NativeNotification, 'id'>>({ data, ...rest }: Shown) {
  return { ...rest, data: data === null ? undefined : JSON.parse(data) }
}

export const Notifications = {
  getPermission: () => native.getPermission(),

  /** provisional (iOS 12+): no prompt; notifications go quietly to Notification Center. */
  requestPermission: ({ provisional = false } = {}) => native.requestPermission({ provisional }),

  /** Opens the app's notification settings. */
  openSettings: () => native.openSettings(),

  /** The id it was scheduled with, to cancel it. Scheduling an id again replaces it. */
  schedule(
    content: NotificationContent,
    trigger: NotificationTrigger = null,
    id?: string,
  ): Promise<string> {
    const notification: NativeNotification = {
      id: id ?? `${Date.now()}-${nextId++}`,
      title: content.title,
      body: content.body ?? '',
      data: content.data === undefined ? null : JSON.stringify(content.data),
      sound: content.sound ?? true,
      channelId: content.channelId ?? 'default',
    }

    return native.schedule(notification, nativeTrigger(trigger))
  },

  cancel: (id: string) => native.cancel(id),

  cancelAll: () => native.cancelAll(),

  async getScheduled(): Promise<ScheduledNotification[]> {
    const scheduled = await native.getScheduled()

    return scheduled.map(({ id, content, trigger }) => ({
      id,
      content: fromNative(content),
      trigger: fromNativeTrigger(trigger),
    }))
  },

  /**
   * Whether a notification shows while the app is open, until the app quits. Both default to true;
   * onReceived is called either way.
   */
  setForegroundPresentation: (presentation: ForegroundPresentation) =>
    native.setForegroundPresentation(presentation),

  /** Android 8+: the channel a notification goes to, which the user can mute. iOS: nothing to do. */
  setChannel: ({ id, name, description = '', importance = 'default' }: NotificationChannel) =>
    native.setChannel({ id, name, description, importance }),

  /** A notification that arrived while the app was open. */
  onReceived(listener: (notification: Notification) => void): NativeSubscription {
    return addNativeListener<NativeNotification>('notifications.received', (notification) =>
      listener(fromNative(notification)),
    )
  },

  /** The user tapped a notification while the app was running. A tap that opened it: getLastResponse. */
  onResponse(listener: (response: NotificationResponse) => void): NativeSubscription {
    const subscription = { remove: () => responseListeners.delete(listener) }

    responseListeners.add(listener)
    if (getCurrentInstance()) onUnmounted(subscription.remove)

    return subscription
  },

  /**
   * The tap that opened the app, which came before any onResponse listener: call it on start. null
   * once read, or when onResponse got it.
   */
  async getLastResponse(): Promise<NotificationResponse | null> {
    const response = await native.getLastResponse()

    if (!response || handledTaps.has(response.tapId)) return null

    return { notification: fromNative(response.notification) }
  },
}
