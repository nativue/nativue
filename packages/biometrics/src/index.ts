import { requireNativeFunction } from '@nativue/core'

export type BiometricType = 'fingerprint' | 'face' | 'iris'

export interface BiometricStatus {
  /** The device can check a face or a fingerprint, set up or not. */
  available: boolean
  /** The user has set one up: authenticate can work. */
  enrolled: boolean
  types: BiometricType[]
}

export interface AuthenticateOptions {
  /** What it's for: iOS shows it under Face ID or Touch ID, Android under the title. */
  reason: string
  /** Android: the prompt's title; the reason when there's none. */
  title?: string
  /** The button that gives up. */
  cancelLabel?: string
  /** Let the device's passcode, PIN or pattern stand in for the face or fingerprint. */
  allowDeviceCredential?: boolean
}

export type AuthenticationError =
  /** The user canceled. */
  | 'canceled'
  /** The system ended it: the app went to the background, a call came in. */
  | 'interrupted'
  /** Too many tries: the device's passcode unlocks biometrics again. */
  | 'lockout'
  /** Nothing set up: no face or fingerprint (or, with allowDeviceCredential, no passcode). */
  | 'not_enrolled'
  /** No biometrics on this device, or turned off. */
  | 'not_available'
  /** It didn't match. */
  | 'failed'

export type AuthenticationResult =
  { success: true } | { success: false; error: AuthenticationError }

const nativeAuthenticate =
  requireNativeFunction<(options: Required<AuthenticateOptions>) => Promise<AuthenticationResult>>(
    'biometrics.authenticate',
  )

export const Biometrics = {
  getStatus: requireNativeFunction<() => Promise<BiometricStatus>>('biometrics.getStatus'),

  /**
   * Asks for the user's face or fingerprint. Resolves `{ success: false, error }` when it doesn't happen,
   * as a cancel is an answer, not a failure of the app.
   */
  async authenticate(options: AuthenticateOptions): Promise<AuthenticationResult> {
    const { reason, title = '', cancelLabel = '', allowDeviceCredential = false } = options

    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new TypeError('Biometrics.authenticate: reason says what it is for')
    }

    return nativeAuthenticate({ reason, title, cancelLabel, allowDeviceCredential })
  },
}
