<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import { Stack } from '@nativue/core/router'
import {
  WebView,
  type WebViewMethods,
  type WebViewNavigation,
  type WebViewSource,
} from '@nativue/webview'

const BUTTON_CLASS =
  'flex-1 items-center rounded-xl bg-white py-2 active:bg-slate-200 dark:bg-slate-800 dark:active:bg-slate-700'
const BUTTON_TEXT_CLASS = 'font-semibold text-slate-900 dark:text-white'

// A page that talks to the app: it posts the button presses, and shows what the app sends.
const HTML = `<!doctype html>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>From the app</title>
<style>
  body { font: 17px -apple-system, system-ui, sans-serif; padding: 16px; color: #0B1220; }
  button { font: inherit; padding: 10px 16px; border: 0; border-radius: 10px; background: #0E9F84; color: white; }
</style>
<h2>An HTML page</h2>
<p><button onclick="window.nativueWebView.postMessage('Hello from the page')">Send to the app</button></p>
<p id="received">Nothing from the app yet</p>
<p><a href="tel:+5511999999999">A phone link</a> opens the phone app.</p>
<script>
  window.addEventListener('message', (event) => {
    document.getElementById('received').textContent = 'The app sent: ' + event.data
  })
<\/script>`

const pages = {
  web: { uri: 'https://vuejs.org' },
  html: { html: HTML },
} satisfies Record<string, WebViewSource>

const page = ref<keyof typeof pages>('web')
const webView = useTemplateRef<WebViewMethods>('webView')
const navigation = ref<WebViewNavigation | null>(null)
const status = ref('')
const source = computed(() => pages[page.value])

function show(nextPage: keyof typeof pages) {
  page.value = nextPage
  status.value = ''
}

async function readTitle() {
  status.value = `document.title: ${await webView.value?.evaluateJavaScript<string>('document.title')}`
}

async function sendMessage() {
  await webView.value?.postMessage(`hi, at ${new Date().toLocaleTimeString()}`)
}
</script>

<template>
  <View class="flex-1 bg-slate-100 dark:bg-black">
    <Stack.Screen :options="{ title: 'WebView' }" />

    <View class="gap-2 p-3">
      <View class="flex-row gap-2">
        <Pressable :class="BUTTON_CLASS" @press="show('web')">
          <Text :class="BUTTON_TEXT_CLASS">vuejs.org</Text>
        </Pressable>
        <Pressable :class="BUTTON_CLASS" @press="show('html')">
          <Text :class="BUTTON_TEXT_CLASS">HTML</Text>
        </Pressable>
      </View>
      <View class="flex-row gap-2">
        <Pressable
          :class="BUTTON_CLASS"
          :disabled="!navigation?.canGoBack"
          @press="webView?.goBack()"
        >
          <Text :class="BUTTON_TEXT_CLASS">Back</Text>
        </Pressable>
        <Pressable
          :class="BUTTON_CLASS"
          :disabled="!navigation?.canGoForward"
          @press="webView?.goForward()"
        >
          <Text :class="BUTTON_TEXT_CLASS">Forward</Text>
        </Pressable>
        <Pressable :class="BUTTON_CLASS" @press="webView?.reload()">
          <Text :class="BUTTON_TEXT_CLASS">Reload</Text>
        </Pressable>
      </View>
      <View class="flex-row gap-2">
        <Pressable :class="BUTTON_CLASS" @press="readTitle">
          <Text :class="BUTTON_TEXT_CLASS">Read title</Text>
        </Pressable>
        <Pressable :class="BUTTON_CLASS" @press="sendMessage">
          <Text :class="BUTTON_TEXT_CLASS">Send to page</Text>
        </Pressable>
      </View>
      <Text class="text-slate-500 dark:text-slate-400" :number-of-lines="1">
        {{ navigation?.loading ? 'Loading…' : (navigation?.url ?? '') }}
      </Text>
      <Text v-if="status" class="text-slate-500 dark:text-slate-400">{{ status }}</Text>
    </View>

    <WebView
      ref="webView"
      class="flex-1"
      :source="source"
      allows-back-forward-navigation-gestures
      @navigation-state-change="navigation = $event"
      @message="status = `The page sent: ${$event.data}`"
      @error="status = `Error ${$event.code}: ${$event.description}`"
      @http-error="status = `HTTP ${$event.statusCode}`"
    />
  </View>
</template>
