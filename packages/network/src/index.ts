import { shallowRef, type ShallowRef } from 'vue'
import { addNativeListener, requireNativeFunction, type NativeSubscription } from '@nativue/core'

export type ConnectionType = 'wifi' | 'cellular' | 'ethernet' | 'other' | 'none'

export interface NetworkState {
  /** A network is up. It may still not reach the internet: a captive portal, a router without a line. */
  isConnected: boolean
  /** Android: the system checked that it reaches the internet. iOS: the same as isConnected. */
  isInternetReachable: boolean
  /** 'other': Bluetooth, or a network the system doesn't name. 'none': offline. */
  type: ConnectionType
  /** Metered, as cellular or a phone's hotspot: leave big downloads for later. */
  isExpensive: boolean
}

const CHANGE_EVENT = 'network.change'

export const Network = {
  getState: requireNativeFunction<() => Promise<NetworkState>>('network.getState'),

  /** Called on each change; in a component, removed on unmount. */
  addListener(listener: (state: NetworkState) => void): NativeSubscription {
    return addNativeListener(CHANGE_EVENT, listener)
  },
}

/** The network's state, live: null until it's first read. Also outside components (a store). */
export function useNetworkState(): ShallowRef<NetworkState | null> {
  const state: ShallowRef<NetworkState | null> = shallowRef(null)
  let hasChanged = false

  Network.getState()
    .then((current) => {
      // A change that arrived meanwhile is newer than this read.
      if (!hasChanged) state.value = current
    })
    .catch((error) => console.error(error))
  Network.addListener((changed) => {
    hasChanged = true
    state.value = changed
  })

  return state
}
