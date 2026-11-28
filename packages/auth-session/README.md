# @nativue/auth-session

OAuth sign-in (Google, Apple, GitHub, your own server...) in [nativue](https://github.com/nativue/nativue)
apps, in the system's secure browser: ASWebAuthenticationSession on iOS, Custom Tabs on Android. The
user signs in where the app can't read the password, with what the browser already knows.

```sh
npm install @nativue/auth-session
```

Then rebuild the app (`npm run ios`, `npm run android`): its native code is linked when the app is
built.

## Sign in with PKCE

The authorization code flow with PKCE, the one for apps (RFC 8252): no client secret in the app.

```ts
import { AuthSession } from '@nativue/auth-session'

const redirectUri = 'myapp://oauth' // the app's scheme, from nativue.config.ts
const { codeVerifier, codeChallenge } = await AuthSession.createPKCE()
const state = await AuthSession.randomState()
const authorize = new URL('https://accounts.example.com/authorize')

authorize.search = new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: 'openid profile',
  state,
  code_challenge: codeChallenge,
  code_challenge_method: 'S256',
}).toString()

const result = await AuthSession.open(authorize.toString(), redirectUri)

if (result.type === 'success' && result.params.state === state) {
  const response = await fetch('https://accounts.example.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      code: result.params.code,
      code_verifier: codeVerifier,
    }).toString(),
  })
  const { access_token } = await response.json()
}
```

Keep the tokens in `@nativue/secure-store`.

## open(url, redirectUri, options)

- `redirectUri` is a URL with the app's scheme (`scheme` in `nativue.config.ts`), registered with the
  provider. `https` redirects aren't taken.
- It resolves `{ type: 'success', url, params }` when the provider redirects there (`params` merges
  the query and the fragment, where the implicit flow puts tokens), or `{ type: 'cancel' }` when the
  user closes the browser.
- `ephemeral: true` starts with no cookies or sign-ins from the browser and leaves none behind. On iOS
  it also skips the "wants to use … to sign in" alert; on Android it needs a browser that supports it
  (Chrome 136 and later), and others ignore it.
- One at a time: a second call rejects with `ERR_UNAVAILABLE`, as it does without a browser.

On Android the redirect is a link to the app, taken before the router. If the system closed the app
while the user signed in, it starts again with that link instead: `onOpenURL` gets it.

## createPKCE() and randomState()

`createPKCE()` gives `{ codeVerifier, codeChallenge, codeChallengeMethod: 'S256' }`, and
`randomState()` a state to check when it comes back. Both come from the system's secure random
generator: 32 bytes, base64url.

## Permissions

None. The redirect needs the app's `scheme` in `nativue.config.ts`.
