# @nativue/notifications

Local notifications in [nativue](https://github.com/nativue/nativue) apps: scheduled now, in some
seconds, at a date or every day, with taps that open the app. `UNUserNotificationCenter` on iOS,
`AlarmManager` and `NotificationManager` on Android.

```sh
npm install @nativue/notifications
```

Then rebuild the app (`npm run ios`, `npm run android`): its native code is linked when the app is
built.

```ts
import { usePermission } from 'vue'
import { Notifications } from '@nativue/notifications'

const { permission, request } = usePermission(
  Notifications.getPermission,
  Notifications.requestPermission,
)

async function remind() {
  const { granted } = await request()
  if (!granted) return

  await Notifications.schedule(
    { title: 'Stand up', body: 'You have been sitting for an hour', data: { screen: '/health' } },
    { seconds: 3600 },
  )
}
```

## Schedules

| Trigger                                  | When                                           |
| ---------------------------------------- | ---------------------------------------------- |
| `null` (the default)                     | now                                            |
| `{ seconds: 30 }`                        | in 30 seconds                                  |
| `{ seconds: 3600, repeats: true }`       | every hour; repeating needs 60 seconds or more |
| `{ date: new Date('2027-01-01T09:00') }` | at a date                                      |
| `{ hour: 9, minute: 30 }`                | every day at 9:30, in the device's time zone   |

`schedule(content, trigger, id?)` resolves with the notification's id: pass your own to replace a
notification by scheduling it again. `cancel(id)`, `cancelAll()` and `getScheduled()` manage them.

On Android, notifications come within minutes of their time, when Android batches alarms to save
battery. For on-time ones, add the plugin with `exactAlarms`: it asks for `SCHEDULE_EXACT_ALARM`,
which Android 14+ leaves off until the user allows it in Settings (until then, they come as without
it). Android clears alarms when the device restarts; they're scheduled again when it starts.

## Taps

```ts
// A tap while the app runs.
Notifications.onResponse(({ notification }) => router.navigate(notification.data.screen))

// The tap that opened the app: on start.
const response = await Notifications.getLastResponse()
if (response) router.navigate(response.notification.data.screen)
```

Each tap reaches only one of them, so an app can use both without handling a tap twice.

## While the app is open

Notifications show while the app is open too, and `onReceived` is called. To handle them in the app
instead: `Notifications.setForegroundPresentation({ banner: false, sound: false })`.

## Permission

`getPermission()` and `requestPermission()` give `{ status, granted, canAskAgain }`, plus
`provisional` on iOS. `openSettings()` opens the app's notification settings.

| Platform             | State                                      | Gives                                                                             |
| -------------------- | ------------------------------------------ | --------------------------------------------------------------------------------- |
| iOS                  | not asked                                  | `undetermined`                                                                    |
| iOS                  | allowed                                    | `granted`                                                                         |
| iOS 12+              | `requestPermission({ provisional: true })` | `granted`, `provisional: true`: no prompt; they go quietly to Notification Center |
| iOS                  | denied                                     | `denied`, `canAskAgain: false`                                                    |
| Android 13+          | not asked                                  | `undetermined`                                                                    |
| Android 13+          | "Don't allow" once                         | `denied`, `canAskAgain: true`                                                     |
| Android 13+          | "Don't allow" twice                        | `denied`, `canAskAgain: false`                                                    |
| Android              | turned off in Settings                     | `denied`, `canAskAgain: false`                                                    |
| Android 12 and older | on (the default)                           | `granted`                                                                         |

On Android 12L and older there's no prompt: notifications are on unless the user turns them off.

## Permissions it adds

| Permission               | Platform    | When                                     |
| ------------------------ | ----------- | ---------------------------------------- |
| `POST_NOTIFICATIONS`     | Android 13+ | always; asked by `requestPermission()`   |
| `RECEIVE_BOOT_COMPLETED` | Android     | always: alarms set again after a restart |
| `SCHEDULE_EXACT_ALARM`   | Android 12+ | with `exactAlarms`                       |

## Android channels and icon

Notifications go to the `default` channel, named "Notifications". Others are made with
`setChannel({ id, name, importance })` and chosen with `content.channelId`; users can mute each one
in Settings. Its sound and importance can't change once made.

The small icon in the status bar is a bell unless the app gives its own, a white shape on a
transparent PNG:

```ts
import notifications from '@nativue/notifications/plugin'

export default defineConfig({
  plugins: [
    notifications({
      icon: './assets/notification-icon.png',
      iconColor: '#10B39B',
      exactAlarms: true,
    }),
  ],
})
```
