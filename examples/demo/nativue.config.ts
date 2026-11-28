import { defineConfig } from '@nativue/core/config'
import location from '@nativue/location/plugin'
import tailwind from '@nativue/tailwind'

export default defineConfig({
  name: 'Demo',
  scheme: 'nativue',
  ios: { bundleIdentifier: 'dev.nativue.app' },
  android: { package: 'dev.nativue.app' },
  plugins: [tailwind(), location({ background: true })],
})
