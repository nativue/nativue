const DEFAULT_FACE_ID_PERMISSION = 'Confirms it’s you with Face ID.'

/**
 * nativue.config.ts: `plugins: [biometrics({ faceIDPermission: 'Unlock your notes with Face ID' })]`.
 * iOS shows it the first time the app asks for Face ID, and Apple's review reads it: say what it guards.
 */
export default function biometrics({ faceIDPermission = DEFAULT_FACE_ID_PERMISSION } = {}) {
  if (typeof faceIDPermission !== 'string' || faceIDPermission.trim() === '') {
    throw new Error(
      '@nativue/biometrics: faceIDPermission is the text iOS shows, a non-empty string',
    )
  }

  return {
    name: '@nativue/biometrics',
    ios: {
      infoPlist(plist) {
        plist.NSFaceIDUsageDescription ??= faceIDPermission
      },
    },
  }
}
