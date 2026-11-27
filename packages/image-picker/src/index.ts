import { requireNativeFunction, type PermissionResponse } from '@nativue/core'

const MEDIA_TYPES = ['images', 'videos', 'all'] as const

export type MediaType = (typeof MEDIA_TYPES)[number]

export interface PickOptions {
  /** How many can be chosen: 1 (the default), more, or 0 for as many as the system allows. */
  limit?: number
  /** 'images' (the default), 'videos' or 'all'. */
  mediaTypes?: MediaType
}

/** A photo or a video, copied into the app's cache: show it with <Image :source="media.uri" />. */
export interface PickedMedia {
  /** A file:// url in the app's cache, which the system may empty: copy what must stay. */
  uri: string
  type: 'image' | 'video'
  /** In pixels, as the photo or video is shown: turned as its orientation says. */
  width: number
  height: number
  mimeType: string
  /** In bytes. */
  fileSize: number
  /** Videos: in seconds. */
  duration?: number
}

const nativePick =
  requireNativeFunction<(limit: number, mediaTypes: MediaType) => Promise<PickedMedia[]>>(
    'imagePicker.pick',
  )
const nativeTakePhoto =
  requireNativeFunction<() => Promise<PickedMedia | null>>('imagePicker.takePhoto')
const nativeGetPendingResult = requireNativeFunction<() => Promise<PickedMedia[] | null>>(
  'imagePicker.getPendingResult',
)

export const ImagePicker = {
  /**
   * The system's photo picker: no permission needed, the user sees only what they choose to share.
   * Resolves with what was chosen, [] when they cancel.
   */
  async pick({ limit = 1, mediaTypes = 'images' }: PickOptions = {}): Promise<PickedMedia[]> {
    if (!Number.isInteger(limit) || limit < 0) {
      throw new TypeError('ImagePicker.pick: limit is 0 or more, a whole number')
    }
    if (!MEDIA_TYPES.includes(mediaTypes)) {
      throw new TypeError(`ImagePicker.pick: mediaTypes is one of ${MEDIA_TYPES.join(', ')}`)
    }

    return nativePick(limit, mediaTypes)
  },

  /**
   * The camera, for one photo; null when the user cancels. Asks for the camera permission when it
   * needs to, and rejects with ERR_PERMISSION_DENIED when it's refused, ERR_UNAVAILABLE without a
   * camera (a simulator).
   */
  takePhoto: nativeTakePhoto,

  /** For usePermission: the camera's, which takePhoto asks for itself. */
  getCameraPermission: requireNativeFunction<() => Promise<PermissionResponse>>(
    'imagePicker.getCameraPermission',
  ),
  requestCameraPermission: requireNativeFunction<() => Promise<PermissionResponse>>(
    'imagePicker.requestCameraPermission',
  ),

  /**
   * Android may close the app while the camera or the picker is open, to free memory. What was taken or
   * chosen then comes back after the app starts again: call this when it starts, once. null when there's
   * none; always null on iOS.
   */
  getPendingResult: nativeGetPendingResult,
}
