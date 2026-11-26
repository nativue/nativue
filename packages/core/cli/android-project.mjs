// The Android project files prebuild builds from the config, instead of copying them from the
// template: the app's manifest and its strings.
import { androidString, xml } from './serialize.mjs'

// Changes the activity handles itself, so they don't recreate it and restart JS.
const CONFIG_CHANGES = [
  'orientation',
  'screenSize',
  'smallestScreenSize',
  'screenLayout',
  'keyboard',
  'keyboardHidden',
  'uiMode',
  'fontScale',
  'locale',
  'layoutDirection',
]

function element(tag, attributes = {}, children = []) {
  return { tag, attributes, children }
}

function intentFilter(action, categories, children = []) {
  return element('intent-filter', {}, [
    element('action', { 'android:name': action }),
    ...categories.map((category) => element('category', { 'android:name': category })),
    ...children,
  ])
}

function manifest(config) {
  const mainActivity = element(
    'activity',
    {
      'android:name': '.MainActivity',
      'android:configChanges': CONFIG_CHANGES.join('|'),
      'android:exported': 'true',
      'android:launchMode': 'singleTask',
      'android:windowSoftInputMode': 'adjustResize',
    },
    [
      intentFilter('android.intent.action.MAIN', ['android.intent.category.LAUNCHER']),
      intentFilter(
        'android.intent.action.VIEW',
        ['android.intent.category.DEFAULT', 'android.intent.category.BROWSABLE'],
        [element('data', { 'android:scheme': config.scheme })],
      ),
    ],
  )
  const application = element(
    'application',
    {
      'android:icon': '@mipmap/ic_launcher',
      'android:label': '@string/app_name',
      'android:theme': '@style/AppTheme',
    },
    [mainActivity],
  )

  return element(
    'manifest',
    {
      'xmlns:android': 'http://schemas.android.com/apk/res/android',
      'xmlns:tools': 'http://schemas.android.com/tools',
    },
    [application],
  )
}

function strings(config) {
  return element('resources', {}, [
    { tag: 'string', attributes: { name: 'app_name' }, text: androidString(config.name) },
  ])
}

/** Paths relative to android/. */
export function androidProjectFiles(config) {
  return {
    'app/src/main/AndroidManifest.xml': xml(manifest(config)),
    'app/src/main/res/values/strings.xml': xml(strings(config)),
  }
}
