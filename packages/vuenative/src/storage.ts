// AsyncStorage, like @react-native-async-storage: promise-based, string values. Native keeps every
// value in memory (reads never touch the disk, like MMKV) and saves to a file in the background, so
// each call is a fast synchronous native call behind the promise.
const native = globalThis.__native

export const AsyncStorage = {
  async getItem(key: string): Promise<string | null> {
    return native.storageGet(key) ?? null
  },

  async setItem(key: string, value: string | number | boolean): Promise<void> {
    native.storageSet(key, String(value))
  },

  async removeItem(key: string): Promise<void> {
    native.storageRemove(key)
  },

  async getAllKeys(): Promise<string[]> {
    return native.storageKeys()
  },

  async multiGet(keys: string[]): Promise<[string, string | null][]> {
    return keys.map((key) => [key, native.storageGet(key) ?? null])
  },

  async multiSet(pairs: [string, string][]): Promise<void> {
    for (const [key, value] of pairs) native.storageSet(key, value)
  },

  async multiRemove(keys: string[]): Promise<void> {
    for (const key of keys) native.storageRemove(key)
  },

  async clear(): Promise<void> {
    native.storageClear()
  },
}
