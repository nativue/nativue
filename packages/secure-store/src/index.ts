import { requireNativeFunction } from '@nativue/core'

/**
 * iOS: when the value can be read. 'whenUnlocked' (the default) only while the device is unlocked;
 * 'afterFirstUnlock' also while it's locked, once it was unlocked after a restart, for background work.
 * Both move to a new device with an encrypted backup; their 'ThisDeviceOnly' versions don't. Android
 * ignores it: the Keystore keeps its keys on the device.
 */
const ACCESSIBILITIES = [
  'whenUnlocked',
  'afterFirstUnlock',
  'whenUnlockedThisDeviceOnly',
  'afterFirstUnlockThisDeviceOnly',
] as const

export type Accessibility = (typeof ACCESSIBILITIES)[number]

export interface SetItemOptions {
  accessible?: Accessibility
}

const nativeSetItem =
  requireNativeFunction<(key: string, value: string, accessible: Accessibility) => Promise<void>>(
    'secureStore.setItem',
  )
const nativeGetItem =
  requireNativeFunction<(key: string) => Promise<string | null>>('secureStore.getItem')
const nativeDeleteItem =
  requireNativeFunction<(key: string) => Promise<void>>('secureStore.deleteItem')

function checkKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || key === '') {
    throw new TypeError('SecureStore takes a key that is a non-empty string')
  }
}

/**
 * Small secrets (tokens, passwords), encrypted by the system: the Keychain on iOS, a key of the Android
 * Keystore on Android. Strings only: store objects as JSON.
 */
export const SecureStore = {
  /** Keeps `value` under `key`, replacing what was there. */
  async setItem(key: string, value: string, options: SetItemOptions = {}): Promise<void> {
    checkKey(key)
    if (typeof value !== 'string') throw new TypeError('SecureStore.setItem takes a string value')

    const accessible = options.accessible ?? 'whenUnlocked'
    if (!ACCESSIBILITIES.includes(accessible)) {
      throw new TypeError(`SecureStore.setItem: accessible is one of ${ACCESSIBILITIES.join(', ')}`)
    }

    await nativeSetItem(key, value, accessible)
  },

  /** The value under `key`; null when there's none, or when it can no longer be read. */
  async getItem(key: string): Promise<string | null> {
    checkKey(key)

    return nativeGetItem(key)
  },

  async deleteItem(key: string): Promise<void> {
    checkKey(key)

    await nativeDeleteItem(key)
  },
}
