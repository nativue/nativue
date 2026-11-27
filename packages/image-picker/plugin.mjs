const DEFAULT_CAMERA_PERMISSION = 'Takes photos and videos to add to the app.'
const DEFAULT_MICROPHONE_PERMISSION = 'Records the sound of the videos you take.'

/**
 * nativue.config.ts: `plugins: [imagePicker({ cameraPermission: 'Take photos of your receipts' })]`.
 * iOS shows these texts when it asks for the camera and, for videos, the microphone; Apple's review
 * reads them: say what they're for.
 */
export default function imagePicker({
  cameraPermission = DEFAULT_CAMERA_PERMISSION,
  microphonePermission = DEFAULT_MICROPHONE_PERMISSION,
} = {}) {
  checkText('cameraPermission', cameraPermission)
  checkText('microphonePermission', microphonePermission)

  return {
    name: '@nativue/image-picker',
    ios: {
      infoPlist(plist) {
        plist.NSCameraUsageDescription ??= cameraPermission
        plist.NSMicrophoneUsageDescription ??= microphonePermission
      },
    },
  }
}

function checkText(option, text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error(`@nativue/image-picker: ${option} is the text iOS shows, a non-empty string`)
  }
}
