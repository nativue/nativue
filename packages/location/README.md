# @nativue/location

The device's location in [nativue](https://github.com/nativue/nativue) apps: where it is now, the
last place the system knows, or updates as it moves.

```sh
npm install @nativue/location
```

Then rebuild the app (`npm run ios`, `npm run android`): its native code is linked when the app is
built.

```ts
import { usePermission } from 'vue'
import { Location } from '@nativue/location'

const { permission, request } = usePermission(Location.getPermission, Location.requestPermission)

const { granted } = await request()
if (granted) {
  const { coords } = await Location.getCurrentPosition({ accuracy: 'high' })
}

// Until remove(); in a component, also on unmount.
const watch = Location.watchPosition({ distanceInterval: 10 }, ({ coords }) => moveMarker(coords))
watch.remove()
```

## Setup

The permission texts iOS shows go in `nativue.config.ts`; Apple's review reads them, so say what the
location is for:

```ts
import location from '@nativue/location/plugin'

export default defineConfig({
  plugins: [location({ whenInUsePermission: 'Shows the stores near you' })],
})
```

| Option                | Default                                                                               |
| --------------------- | ------------------------------------------------------------------------------------- |
| `whenInUsePermission` | iOS: "Shows where you are while you use the app."                                     |
| `alwaysPermission`    | iOS, with `background`: "Keeps track of where you are, also while the app is closed." |
| `background`          | `false`: see [In the background](#in-the-background)                                  |

## API

| Function                                                                               |                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `getPermission()`                                                                      | the permission, for `usePermission`                                                                                                                                                              |
| `requestPermission({ background? })`                                                   | asks to use the location while the app is in use; `background: true` then asks for always                                                                                                        |
| `getCurrentPosition({ accuracy?, timeout? })`                                          | where the device is now                                                                                                                                                                          |
| `getLastKnownPosition()`                                                               | the last position the system knows, from any app, at once and without the GPS: maybe old (check `timestamp`), `null` if none                                                                     |
| `watchPosition({ accuracy?, distanceInterval?, timeInterval? }, onPosition, onError?)` | updates as the device moves, until `remove()`                                                                                                                                                    |
| `hasServicesEnabled()`                                                                 | location is turned on in the system's settings                                                                                                                                                   |
| `enableServices()`                                                                     | Android: asks to turn location on, in a system dialog, and resolves whether it's on. iOS has no such dialog: the user turns it on in Settings (`openSettings()` from `vue` opens the app's page) |

`accuracy` is `'high'` (GPS, a few meters, the most battery), `'balanced'` (the default, about 100 m,
from Wi-Fi and cell towers) or `'low'` (about a kilometer). `timeout` is 30 seconds by default.
`distanceInterval` is the meters between updates (0 by default); `timeInterval` the milliseconds
between them on Android (5 seconds by default), as iOS updates as the device moves.

A position, as on the web:

```ts
{
  coords: { latitude, longitude, accuracy, altitude, altitudeAccuracy, heading, speed },
  timestamp, // milliseconds since 1970
}
```

`accuracy` is in meters; `altitude`, `altitudeAccuracy`, `heading` (degrees from north) and `speed`
(meters per second) are `null` when the device didn't measure them.

## Errors

| `code`                  | When                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `ERR_PERMISSION_DENIED` | there's no permission (ask first with `requestPermission`), or it was taken away while watching |
| `ERR_UNAVAILABLE`       | location is turned off on the device, or no position could be had                               |
| `ERR_TIMEOUT`           | `getCurrentPosition` got no position within `timeout`                                           |
| `ERR_INVALID_ARGUMENT`  | `requestPermission({ background: true })` without `location({ background: true })`              |

`watchPosition` calls `onError` with them, and stops.

## Permissions

| Field         |                                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| `status`      | `'granted'`, `'denied'` or `'undetermined'`                                                                           |
| `accuracy`    | when granted: `'precise'`, or `'approximate'` when the user shares only roughly where they are (iOS 14+, Android 12+) |
| `scope`       | when granted: `'whenInUse'`, or `'always'` when the app also gets it in the background                                |
| `canAskAgain` | `false`: only Settings can change it now (`openSettings()`)                                                           |

| Platform | Declared                                                                      | Added by                         |
| -------- | ----------------------------------------------------------------------------- | -------------------------------- |
| iOS      | `NSLocationWhenInUseUsageDescription`                                         | always                           |
| iOS      | `NSLocationAlwaysAndWhenInUseUsageDescription`, `UIBackgroundModes: location` | `location({ background: true })` |
| Android  | `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`                              | always                           |
| Android  | `ACCESS_BACKGROUND_LOCATION`                                                  | `location({ background: true })` |

`requestPermission` asks for both Android permissions: on Android 12+ the user picks precise or
approximate.

## In the background

`location({ background: true })` lets the app ask for the location all the time, with
`requestPermission({ background: true })`. Both systems ask for while in use first, then for always:
iOS shows its prompt, Android the app's settings page, where the user picks "Allow all the time".
A watch then goes on while the app is in the background: on iOS with the blue location indicator, on
Android a few times an hour, as Android limits apps in the background.

> [!WARNING]
> Google Play reviews every app that declares `ACCESS_BACKGROUND_LOCATION`. Before publishing it,
> fill in the location permissions declaration in Play Console, record a video of the feature that
> needs it, and show a prominent disclosure in the app, before asking, that says what's collected
> and why ([Google's policy](https://support.google.com/googleplay/android-developer/answer/9799150)).
> Apps that don't need it are rejected: turn `background` on only when the app's main feature works
> with the app closed.

## Android without Google Play services

Positions come from Google Play services' fused provider, which uses GPS, Wi-Fi and cell towers with
the least battery. On devices without it, from the system's GPS and network providers, and
`enableServices()` shows no dialog.

## Planned

Geocoding: an address from coordinates, and coordinates from an address.
