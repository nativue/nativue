import { defineConfig } from '@nativue/core/config'

// The app: nativue generates ios/ and android/ from it (npx nativue prebuild, also run by dev,
// build and run). Edit this file, not those folders.
export default defineConfig({
  name: '__DISPLAY_NAME__',
  scheme: '__URL_SCHEME__',
  ios: { bundleIdentifier: '__BUNDLE_ID__' },
  android: { package: '__BUNDLE_ID__' },
})
