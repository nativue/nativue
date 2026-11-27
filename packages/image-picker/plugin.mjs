const DEFAULT_CAMERA_PERMISSION = 'Takes photos to add to the app.'

/**
 * nativue.config.ts: `plugins: [imagePicker({ cameraPermission: 'Take photos of your receipts' })]`.
 * iOS shows cameraPermission when it asks for the camera, and Apple's review reads it: say what the
 * photos are for.
 */
export default function imagePicker({ cameraPermission = DEFAULT_CAMERA_PERMISSION } = {}) {
  if (typeof cameraPermission !== 'string' || cameraPermission.trim() === '') {
    throw new Error(
      '@nativue/image-picker: cameraPermission is the text iOS shows, a non-empty string',
    )
  }

  return {
    name: '@nativue/image-picker',
    ios: {
      infoPlist(plist) {
        plist.NSCameraUsageDescription ??= cameraPermission
      },
    },
  }
}
