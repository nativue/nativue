<script setup lang="ts">
import { ref } from 'vue'
import { Stack } from '@nativue/core/router'
import { AuthSession } from '@nativue/auth-session'
import Page from '@/components/Page.vue'
import Section from '@/components/Section.vue'

const BUTTON_CLASS =
  'flex-1 items-center rounded-xl bg-white py-3 active:bg-slate-200 dark:bg-slate-800 dark:active:bg-slate-700'
const REDIRECT_URI = 'nativue://oauth'
// Duende's public demo of an OAuth server, with a public client for apps: sign in as bob, password bob.
const PROVIDER = 'https://demo.duendesoftware.com'
const CLIENT_ID = 'interactive.public'

const status = ref('')

// The authorization code flow with PKCE, as an app does it: no client secret.
async function signIn(ephemeral: boolean) {
  try {
    const { codeVerifier, codeChallenge, codeChallengeMethod } = await AuthSession.createPKCE()
    const state = await AuthSession.randomState()
    const query = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'openid profile api',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
    })
    const result = await AuthSession.open(`${PROVIDER}/connect/authorize?${query}`, REDIRECT_URI, {
      ephemeral,
    })

    if (result.type === 'cancel') return (status.value = 'Closed before signing in')
    if (result.params.state !== state) return (status.value = 'The state came back changed')

    status.value = await exchange(result.params.code, codeVerifier)
  } catch (failure) {
    status.value = (failure as Error).message
  }
}

async function exchange(code: string, codeVerifier: string) {
  const response = await fetch(`${PROVIDER}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code,
      code_verifier: codeVerifier,
    }).toString(),
  })
  const token = (await response.json()) as { access_token?: string; expires_in?: number }

  return token.access_token
    ? `Signed in: an access token for ${token.expires_in} s`
    : `The token request failed (${response.status})`
}
</script>

<template>
  <Page>
    <Stack.Screen :options="{ title: 'Auth session' }" />

    <Section
      title="Sign in"
      footer="Duende's demo OAuth server, in the system's secure browser: sign in as bob, password bob."
    >
      <View class="flex-row gap-2">
        <Pressable :class="BUTTON_CLASS" @press="signIn(false)">
          <Text class="font-semibold text-slate-900 dark:text-white">Sign in</Text>
        </Pressable>
        <Pressable :class="BUTTON_CLASS" @press="signIn(true)">
          <Text class="font-semibold text-slate-900 dark:text-white">Ephemeral</Text>
        </Pressable>
      </View>
      <Text v-if="status" class="text-slate-500 dark:text-slate-400">{{ status }}</Text>
    </Section>
  </Page>
</template>
