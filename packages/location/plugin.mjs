const DEFAULT_WHEN_IN_USE_PERMISSION = 'Shows where you are while you use the app.'
const DEFAULT_ALWAYS_PERMISSION = 'Keeps track of where you are, also while the app is closed.'
const BACKGROUND_LOCATION = 'android.permission.ACCESS_BACKGROUND_LOCATION'

/**
 * nativue.config.ts: `plugins: [location({ whenInUsePermission: 'Shows stores near you' })]`. iOS
 * shows these texts when it asks; Apple's review reads them: say what the location is for.
 * `background: true` lets the app ask for the location all the time: Google Play then requires a
 * declaration, a video and a prominent disclosure in the app (see the README).
 */
export default function location({
  whenInUsePermission = DEFAULT_WHEN_IN_USE_PERMISSION,
  alwaysPermission = DEFAULT_ALWAYS_PERMISSION,
  background = false,
} = {}) {
  checkText('whenInUsePermission', whenInUsePermission)
  checkText('alwaysPermission', alwaysPermission)

  return {
    name: '@nativue/location',
    ios: {
      infoPlist(plist) {
        plist.NSLocationWhenInUseUsageDescription ??= whenInUsePermission
        if (!background) return

        plist.NSLocationAlwaysAndWhenInUseUsageDescription ??= alwaysPermission
        plist.UIBackgroundModes = [...new Set([...(plist.UIBackgroundModes ?? []), 'location'])]
      },
    },
    android: {
      manifest(manifest) {
        if (!background) return

        manifest.children.unshift({
          tag: 'uses-permission',
          attributes: { 'android:name': BACKGROUND_LOCATION },
          children: [],
        })
      },
    },
  }
}

function checkText(option, text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error(`@nativue/location: ${option} is the text iOS shows, a non-empty string`)
  }
}
