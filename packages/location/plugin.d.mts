import type { NativuePlugin } from '@nativue/core/config'

export interface LocationPluginOptions {
  /** iOS: what the prompt for the location while the app is in use says it's for. */
  whenInUsePermission?: string
  /** iOS: what the prompt for the location all the time says, with `background`. */
  alwaysPermission?: string
  /**
   * Lets the app ask for the location all the time and get it in the background: iOS's location
   * background mode, Android's ACCESS_BACKGROUND_LOCATION. Google Play reviews apps that declare it.
   */
  background?: boolean
}

export default function location(options?: LocationPluginOptions): NativuePlugin
