import type { NativuePlugin } from '@nativue/core/config'

export interface BiometricsOptions {
  /** iOS: what the Face ID prompt says it's for, the first time the app asks. */
  faceIDPermission?: string
}

export default function biometrics(options?: BiometricsOptions): NativuePlugin
