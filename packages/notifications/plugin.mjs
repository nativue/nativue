import { basename } from 'node:path'

/** nativue.config.ts: `plugins: [notifications({ exactAlarms: true, icon: './assets/bell.png' })]` */
export default function notifications({ exactAlarms = false, icon, iconColor, sounds = [] } = {}) {
  if (iconColor !== undefined && !/^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(iconColor)) {
    throw new Error(
      `@nativue/notifications: iconColor is '#RRGGBB' or '#AARRGGBB', not '${iconColor}'`,
    )
  }

  checkSounds(sounds)

  return {
    name: '@nativue/notifications',
    resources: [
      // Android's small icon is drawn in one color: a white shape on transparent, not the app's icon.
      ...(icon
        ? [{ source: icon, ios: false, android: { type: 'drawable', name: 'notification_icon' } }]
        : []),
      // The bundle's root on iOS, res/raw on Android: where each looks for a notification's sound.
      ...sounds.map((source) => ({ source })),
    ],
    android: {
      manifest(manifest) {
        if (!exactAlarms) return

        // Denied by default on Android 14+: notifications come late, as without it, until the user allows it.
        manifest.children.unshift({
          tag: 'uses-permission',
          attributes: { 'android:name': 'android.permission.SCHEDULE_EXACT_ALARM' },
          children: [],
        })
      },
      strings(strings) {
        if (iconColor) strings.notification_icon_color = iconColor
      },
    },
  }
}

/** WAV plays on both: iOS also takes AIFF and CAF, which Android doesn't. */
function checkSounds(sounds) {
  if (!Array.isArray(sounds)) {
    throw new Error("@nativue/notifications: sounds is a list, e.g. ['./assets/chime.wav']")
  }

  const fileNames = sounds.map((source) => basename(source))
  const badName = fileNames.find((fileName) => !/^[a-z][a-z0-9_]*\.wav$/.test(fileName))
  const repeatedName = fileNames.find((fileName, index) => fileNames.indexOf(fileName) !== index)

  if (badName) {
    throw new Error(
      `@nativue/notifications: a sound is a .wav named with lowercase letters, digits and underscores (Android's rule), not '${badName}'`,
    )
  }
  if (repeatedName) {
    throw new Error(
      `@nativue/notifications: two sounds are named '${repeatedName}': the app plays them by name`,
    )
  }
}
