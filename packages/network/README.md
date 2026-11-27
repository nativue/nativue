# @nativue/network

Whether a [nativue](https://github.com/nativue/nativue) app is online, and on what connection, live.

```sh
npm install @nativue/network
```

Then rebuild the app (`npm run ios`, `npm run android`): its native code is linked when the app is
built.

```vue
<script setup lang="ts">
import { useNetworkState } from '@nativue/network'

const network = useNetworkState() // null until it's first read
</script>

<template>
  <Text v-if="network && !network.isConnected">You're offline</Text>
</template>
```

Outside a component:

```ts
import { Network } from '@nativue/network'

const state = await Network.getState()
const subscription = Network.addListener((state) => console.log(state.type))
subscription.remove() // in a component, it's removed on unmount
```

## The state

| Field                 |                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `isConnected`         | a network is up. It may still not reach the internet: a captive portal, a dead router    |
| `isInternetReachable` | Android: the system checked that it reaches the internet. iOS: the same as `isConnected` |
| `type`                | `'wifi'`, `'cellular'`, `'ethernet'`, `'other'` (VPN, Bluetooth...) or `'none'`          |
| `isExpensive`         | metered, as cellular or a phone's hotspot: leave big downloads for later                 |

A request can still fail while connected: handle `fetch` errors anyway, and use this to explain them
or to wait for the connection to come back.

On Android, going offline is reported a second after the network is lost, when no other has taken
over: turning Wi-Fi off with cellular on goes from `'wifi'` to `'cellular'`, never through `'none'`.

## Permissions

| Permission             | Platform | When                                               |
| ---------------------- | -------- | -------------------------------------------------- |
| `ACCESS_NETWORK_STATE` | Android  | always; granted when the app installs, never asked |

iOS needs none.
