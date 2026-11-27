import { requireNativeFunction, type PermissionResponse } from '@nativue/core'

const MEDIA_TYPES = ['images', 'videos', 'all'] as const
const VIDEO_QUALITIES = ['high', 'low'] as const

export type MediaType = (typeof MEDIA_TYPES)[number]
export type VideoQuality = (typeof VIDEO_QUALITIES)[number]

export interface PickOptions {
  /** How many can be chosen: 1 (the default), more, or 0 for as many as the system allows. */
  limit?: number
  /** 'images' (the default), 'videos' or 'all'. */
  mediaTypes?: MediaType
}

export interface CameraOptions {
  /**
   * 'images' (the default), 'videos' or 'all'. Android's camera app does one or the other, so 'all'
   * takes a photo there.
   */
  mediaTypes?: MediaType
  /** Videos: the longest they can be, in whole seconds; 0 (the default) for no limit. */
  videoMaxDuration?: number
  /** Videos: 'high' (the default) or 'low', smaller to send. */
  videoQuality?: VideoQuality
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
const nativeOpenCamera =
  requireNativeFunction<
    (
      mediaTypes: MediaType,
      videoMaxDuration: number,
      videoQuality: VideoQuality,
    ) => Promise<PickedMedia | null>
  >('imagePicker.openCamera')
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
    checkOneOf('ImagePicker.pick', 'mediaTypes', mediaTypes, MEDIA_TYPES)

    return nativePick(limit, mediaTypes)
  },

  /**
   * The camera, for one photo or video; null when the user cancels. Asks for the camera permission
   * (and the microphone's, for videos on iOS) when it needs to, and rejects with ERR_PERMISSION_DENIED
   * when it's refused, ERR_UNAVAILABLE without a camera that takes them (a simulator's takes no videos).
   */
  async openCamera({
    mediaTypes = 'images',
    videoMaxDuration = 0,
    videoQuality = 'high',
  }: CameraOptions = {}): Promise<PickedMedia | null> {
    checkOneOf('ImagePicker.openCamera', 'mediaTypes', mediaTypes, MEDIA_TYPES)
    checkOneOf('ImagePicker.openCamera', 'videoQuality', videoQuality, VIDEO_QUALITIES)
    if (!Number.isInteger(videoMaxDuration) || videoMaxDuration < 0) {
      throw new TypeError('ImagePicker.openCamera: videoMaxDuration is a whole number of seconds')
    }

    return nativeOpenCamera(mediaTypes, videoMaxDuration, videoQuality)
  },

  /** For usePermission: the camera's, which openCamera asks for itself. */
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

function checkOneOf<Value extends string>(
  name: string,
  option: string,
  value: Value,
  allowed: readonly Value[],
) {
  if (!allowed.includes(value)) {
    throw new TypeError(`${name}: ${option} is one of ${allowed.join(', ')}`)
  }
}
