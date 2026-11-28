import { requireNativeFunction } from '@nativue/core'

export interface AuthSessionOptions {
  /**
   * Start with no cookies or sign-ins from the browser, and leave none behind. iOS also skips the
   * "wants to use … to sign in" alert. Android: on browsers that support it (Chrome 136 and later).
   */
  ephemeral?: boolean
}

export type AuthSessionResult =
  /**
   * The provider sent the user back: url is where, params its query and fragment, merged. A provider that
   * refused (the user denied access) sends `error` instead of `code`.
   */
  | { type: 'success'; url: string; params: Record<string, string | undefined> }
  /** The user closed the browser before finishing. */
  | { type: 'cancel' }

export interface PKCE {
  /** Kept by the app, and sent with the code to the token endpoint. */
  codeVerifier: string
  /** Sent in the authorization URL, with code_challenge_method=S256. */
  codeChallenge: string
  codeChallengeMethod: 'S256'
}

type NativeResult = { type: 'success'; url: string } | { type: 'cancel' }

const nativeOpen =
  requireNativeFunction<
    (url: string, redirectUri: string, ephemeral: boolean) => Promise<NativeResult>
  >('authSession.open')
const nativeCreatePKCE = requireNativeFunction<() => Promise<PKCE>>('authSession.createPKCE')
const nativeRandomString = requireNativeFunction<() => Promise<string>>('authSession.randomString')

export const AuthSession = {
  /**
   * Opens url in the system's secure browser (ASWebAuthenticationSession on iOS, Custom Tabs on Android)
   * and waits for the provider to redirect to redirectUri: a URL with the app's scheme, `myapp://oauth`.
   */
  async open(url: string, redirectUri: string, { ephemeral = false }: AuthSessionOptions = {}) {
    if (!/^https?:\/\//i.test(url)) {
      throw new TypeError(`AuthSession.open: ${url} isn't an http(s) URL`)
    }
    if (!/^[a-z][a-z0-9+.-]*:/i.test(redirectUri) || /^https?:/i.test(redirectUri)) {
      throw new TypeError(
        `AuthSession.open: ${redirectUri} isn't a URL with the app's scheme, like myapp://oauth`,
      )
    }

    const result = await nativeOpen(url, redirectUri, ephemeral)

    return result.type === 'success'
      ? ({ type: 'success', url: result.url, params: params(result.url) } as const)
      : result
  },

  /** A code verifier and its S256 challenge, for the authorization code flow with PKCE. */
  createPKCE: nativeCreatePKCE,

  /** 32 random bytes, base64url: a state to send and check when the provider sends it back. */
  randomState: nativeRandomString,
}

/** Codes come in the query, tokens of the implicit flow in the fragment: both, the fragment's last. */
function params(url: string): Record<string, string> {
  const [beforeFragment, fragment = ''] = url.split('#', 2)
  const query = beforeFragment.includes('?')
    ? beforeFragment.slice(beforeFragment.indexOf('?') + 1)
    : ''

  return {
    ...Object.fromEntries(new URLSearchParams(query)),
    ...Object.fromEntries(new URLSearchParams(fragment)),
  }
}
