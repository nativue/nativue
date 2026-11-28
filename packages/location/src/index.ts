import {
  addNativeListener,
  getCurrentInstance,
  NativeError,
  onUnmounted,
  requireNativeFunction,
  type NativeSubscription,
  type PermissionResponseWith,
} from '@nativue/core'

export type LocationPermission = PermissionResponseWith<{
  /** When granted: 'approximate' when the user shares only roughly where they are. */
  accuracy?: 'precise' | 'approximate'
  /** When granted: 'always' also while the app is in the background. */
  scope?: 'whenInUse' | 'always'
}>

/**
 * 'high': GPS, to a few meters, the most battery. 'balanced': about 100 m, from Wi-Fi and cell
 * towers. 'low': about a kilometer, the least battery.
 */
export type LocationAccuracy = 'high' | 'balanced' | 'low'

export interface Position {
  coords: {
    latitude: number
    longitude: number
    /** Meters; how far off latitude and longitude may be. */
    accuracy: number
    /** Meters above sea level. */
    altitude: number | null
    altitudeAccuracy: number | null
    /** Degrees from true north, while moving. */
    heading: number | null
    /** Meters per second. */
    speed: number | null
  }
  /** When it was measured, in milliseconds since 1970. */
  timestamp: number
}

export interface CurrentPositionOptions {
  accuracy?: LocationAccuracy
  /** Milliseconds before it rejects with ERR_TIMEOUT; 30 seconds by default. */
  timeout?: number
}

export interface WatchPositionOptions {
  accuracy?: LocationAccuracy
  /** Meters the device moves before the next update; 0 by default. */
  distanceInterval?: number
  /** Android: milliseconds between updates, 5 seconds by default. iOS updates as it moves. */
  timeInterval?: number
}

type NativeWatchOptions = Required<WatchPositionOptions>
type WatchEvent = { watchId: number; position?: Position; code?: string; message?: string }

const native = {
  getPermission: requireNativeFunction<() => Promise<LocationPermission>>('location.getPermission'),
  requestPermission: requireNativeFunction<(background: boolean) => Promise<LocationPermission>>(
    'location.requestPermission',
  ),
  getCurrentPosition: requireNativeFunction<
    (accuracy: LocationAccuracy, timeout: number) => Promise<Position>
  >('location.getCurrentPosition'),
  getLastKnownPosition: requireNativeFunction<() => Promise<Position | null>>(
    'location.getLastKnownPosition',
  ),
  hasServicesEnabled: requireNativeFunction<() => Promise<boolean>>('location.hasServicesEnabled'),
  enableServices: requireNativeFunction<() => Promise<boolean>>('location.enableServices'),
  startWatching:
    requireNativeFunction<(watchId: number, options: NativeWatchOptions) => Promise<void>>(
      'location.startWatching',
    ),
  stopWatching: requireNativeFunction<(watchId: number) => Promise<void>>('location.stopWatching'),
}

let lastWatchId = 0

export const Location = {
  getPermission: native.getPermission,

  /**
   * Asks to use the location while the app is in use. `background: true` then asks for always, which
   * needs `location({ background: true })` in nativue.config.ts; Android shows the app's settings
   * page for it, where the user picks "Allow all the time".
   */
  requestPermission: ({ background = false }: { background?: boolean } = {}) =>
    native.requestPermission(background),

  /**
   * Where the device is now. Rejects with ERR_PERMISSION_DENIED without the permission (ask first
   * with requestPermission), ERR_UNAVAILABLE with location turned off, ERR_TIMEOUT after `timeout`.
   */
  getCurrentPosition({ accuracy = 'balanced', timeout = 30_000 }: CurrentPositionOptions = {}) {
    return native.getCurrentPosition(accuracy, timeout)
  },

  /**
   * The last position the system knows, from any app, without turning on the GPS: at once, maybe
   * old (check timestamp), and null when there's none.
   */
  getLastKnownPosition: native.getLastKnownPosition,

  /** Location is turned on in the system's settings. */
  hasServicesEnabled: native.hasServicesEnabled,

  /**
   * Android: asks the user to turn location on, in a system dialog, and resolves whether it's on.
   * iOS has no such dialog: it resolves hasServicesEnabled(), and the user turns it on in Settings.
   */
  enableServices: native.enableServices,

  /**
   * Calls onPosition as the device moves, until remove(); in a component, also on unmount. onError
   * gets the same errors as getCurrentPosition's, and updates stop.
   */
  watchPosition(
    { accuracy = 'balanced', distanceInterval = 0, timeInterval = 5_000 }: WatchPositionOptions,
    onPosition: (position: Position) => void,
    onError: (error: NativeError) => void = (error) => console.error(error),
  ): NativeSubscription {
    const watchId = ++lastWatchId
    let isWatching = true
    const listener = addNativeListener<WatchEvent>('location.watch', (event) => {
      if (event.watchId !== watchId) return
      if (event.position) return onPosition(event.position)

      remove()
      onError(new NativeError(event.message ?? 'Location stopped', event.code ?? 'ERR_UNAVAILABLE'))
    })

    function remove() {
      if (!isWatching) return

      isWatching = false
      listener.remove()
      native.stopWatching(watchId).catch((error) => console.error(error))
    }

    native.startWatching(watchId, { accuracy, distanceInterval, timeInterval }).catch((error) => {
      remove()
      onError(error)
    })
    if (getCurrentInstance()) onUnmounted(remove)

    return { remove }
  },
}
