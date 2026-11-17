// AsyncStorage, like @react-native-async-storage: promise-based, string values. Native keeps every
// value in memory (reads never touch the disk, like MMKV) and saves to a file in the background, so
// each call is a fast synchronous native call behind the promise.
const native = globalThis.__native

export const AsyncStorage = {
  async getItem(key) {
    return native.storageGet(key) ?? null
  },

  async setItem(key, value) {
    native.storageSet(key, String(value))
  },

  async removeItem(key) {
    native.storageRemove(key)
  },

  async getAllKeys() {
    return native.storageKeys()
  },

  async multiGet(keys) {
    return keys.map((key) => [key, native.storageGet(key) ?? null])
  },

  async multiSet(pairs) {
    for (const [key, value] of pairs) native.storageSet(key, String(value))
  },

  async multiRemove(keys) {
    for (const key of keys) native.storageRemove(key)
  },

  async clear() {
    native.storageClear()
  },
}
