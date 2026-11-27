/** nativue.config.ts: `plugins: [notifications({ exactAlarms: true, icon: './assets/bell.png' })]` */
export default function notifications({ exactAlarms = false, icon, iconColor } = {}) {
  if (iconColor !== undefined && !/^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(iconColor)) {
    throw new Error(
      `@nativue/notifications: iconColor is '#RRGGBB' or '#AARRGGBB', not '${iconColor}'`,
    )
  }

  return {
    name: '@nativue/notifications',
    // Android's small icon is drawn in one color: a white shape on transparent, not the app's icon.
    resources: icon
      ? [{ source: icon, ios: false, android: { type: 'drawable', name: 'notification_icon' } }]
      : [],
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
