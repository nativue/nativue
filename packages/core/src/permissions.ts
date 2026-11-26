// Permissions as packages report them, the same on iOS and Android.
import { getCurrentInstance, onMounted, shallowRef, type ShallowRef } from '@vue/runtime-core'
import { addNativeListener } from './native-events'
import { NativeError } from './native-functions'

/**
 * granted: the feature works, maybe partly (limited photos), as the package's own fields say.
 * canAskAgain false: only the system's Settings can change it now (openSettings()).
 */
export interface PermissionResponse {
  status: 'granted' | 'denied' | 'undetermined'
  granted: boolean
  canAskAgain: boolean
}

export type PermissionResponseWith<Extra extends object> = PermissionResponse & Extra

/**
 * A permission's state, read on mount, after request, and when the app comes back to the front (the
 * user may have changed it in Settings), e.g. usePermission(Camera.getPermission, Camera.requestPermission).
 */
export function usePermission<Response extends PermissionResponse, Arguments extends unknown[]>(
  get: () => Promise<Response>,
  request: (...args: Arguments) => Promise<Response>,
): { permission: ShallowRef<Response | null>; request: (...args: Arguments) => Promise<Response> } {
  const permission: ShallowRef<Response | null> = shallowRef(null)
  let latestRead = 0

  // Only the latest read or request is kept: an older one may finish after it.
  async function track(read: Promise<Response>) {
    const readNumber = ++latestRead
    const response = await read

    if (readNumber === latestRead) permission.value = response

    return response
  }

  function refresh() {
    track(get()).catch((error) => console.error(error))
  }

  if (getCurrentInstance()) onMounted(refresh)
  else refresh()
  addNativeListener('app.state', (state) => {
    if (state === 'active') refresh()
  })

  return { permission, request: (...args) => track(request(...args)) }
}

/** The app's page in the system's Settings: where a permission with canAskAgain false is turned on. */
export async function openSettings(): Promise<void> {
  if (!__native.openSettings()) {
    throw new NativeError('This device has no settings page for the app', 'ERR_UNAVAILABLE')
  }
}
