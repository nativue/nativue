// What the native side tells JavaScript without being asked: a plugin's events (registry.sendEvent),
// the URLs the app is opened with, and whether it's in front.
import { getCurrentInstance, onUnmounted } from '@vue/runtime-core'

export type NativeSubscription = { remove(): void }
export type AppStateStatus = 'active' | 'background'

type URLListener = (url: string) => boolean | void
// An object per subscription: the same function added twice is removed one at a time.
type Entry<Listener> = { listener: Listener }

const entriesByEventName = new Map<string, Set<Entry<(payload: never) => void>>>()
const urlEntries = new Set<Entry<URLListener>>()
let navigateToURL: ((url: string) => void) | undefined

/** In a component's setup, also removed when it unmounts. */
function subscribe<Listener>(
  entries: Set<Entry<Listener>>,
  listener: Listener,
): NativeSubscription {
  const entry = { listener }
  const remove = () => entries.delete(entry)

  entries.add(entry)
  if (getCurrentInstance()) onUnmounted(remove)

  return { remove }
}

/** In the order they were added, skipping any an earlier one removed; a throw doesn't stop the rest. */
function callEach<Listener>(
  entries: Set<Entry<Listener>>,
  call: (listener: Listener) => boolean | void,
) {
  for (const entry of [...entries]) {
    if (!entries.has(entry)) continue

    try {
      if (call(entry.listener) === true) return true
    } catch (error) {
      console.error(error)
    }
  }

  return false
}

/**
 * Calls listener with the payload of each `eventName` the native side sends (registry.sendEvent),
 * e.g. addNativeListener('notifications.received', (notification) => ...). Events sent while no
 * JavaScript ran (the app closed, a reload) are lost.
 */
export function addNativeListener<Payload = unknown>(
  eventName: string,
  listener: (payload: Payload) => void,
): NativeSubscription {
  const entries = entriesByEventName.get(eventName) ?? new Set()

  entriesByEventName.set(eventName, entries)

  return subscribe(entries, listener as (payload: never) => void)
}

globalThis.__nativeEvent = (eventName, payload) => {
  const entries = entriesByEventName.get(eventName)

  if (entries) callEach(entries, (listener) => listener(payload as never))
}

/**
 * Calls listener with each URL the app is opened with (deep links, OAuth redirects), before the
 * router: returning true keeps the router from navigating to it. Listeners run in the order they
 * were added; the first to return true stops the rest. The URL that opens the app arrives right
 * after it starts: add the listener for it in src/app.ts or the root layout, not on a later screen.
 */
export function onOpenURL(listener: URLListener): NativeSubscription {
  return subscribe(urlEntries, listener)
}

/** The router's: where a URL no onOpenURL listener took goes. */
export function setURLNavigation(navigate: (url: string) => void): void {
  navigateToURL = navigate
}

globalThis.__openURL = (url) => {
  if (callEach(urlEntries, (listener) => listener(url))) return

  navigateToURL?.(url)
}

/**
 * Whether the app is in front ('active') or not ('background'). Changes reach
 * addNativeListener('app.state', (state: AppStateStatus) => ...).
 */
export const AppState = {
  get current(): AppStateStatus {
    return __native.appState()
  },
}
