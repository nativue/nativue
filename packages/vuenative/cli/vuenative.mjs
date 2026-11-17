#!/usr/bin/env node
// The vuenative CLI, run from the app's folder:
//   vuenative build [--entry file]   bundles src/app/ into ios/App/main.bundle.js
//   vuenative dev                    rebuilds on save and tells the app (via SSE) to reload the bundle
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PORT = 42883 // #42b883, Vue's green
const BUNDLE_DIRECTORY = 'ios/App'
const BUNDLE_PATH = `${BUNDLE_DIRECTORY}/main.bundle.js`
const KEEPALIVE_INTERVAL_MS = 15000

const NATIVE_COMPONENT_TAGS = [
  'View',
  'Text',
  'Button',
  'ScrollView',
  'SafeAreaView',
  'TextInput',
  'KeyboardAvoidingView',
  'Image',
  'Switch',
  'ActivityIndicator',
  'Modal',
  'Svg',
]

function frameworkPath(relativePath) {
  return fileURLToPath(new URL(`../${relativePath}`, import.meta.url))
}

function viteConfig({ mode, entry, plugins = [], watch = null }) {
  // Vite reads the mode from NODE_ENV: development builds keep each component's file (for errors).
  process.env.NODE_ENV = mode

  return {
    configFile: false,
    root: process.cwd(),
    mode,
    plugins: [
      vue({
        template: {
          compilerOptions: { isCustomElement: (tag) => NATIVE_COMPONENT_TAGS.includes(tag) },
        },
      }),
      ...plugins,
    ],
    // Compiled templates and app code import from 'vue': point them to the native renderer.
    resolve: {
      alias: [
        { find: /^vue$/, replacement: frameworkPath('src/renderer.ts') },
        { find: /^vuenative\/router$/, replacement: frameworkPath('src/router.ts') },
        { find: /^@\//, replacement: `${process.cwd()}/src/` },
      ],
    },
    define: { 'process.env.NODE_ENV': JSON.stringify(mode) },
    build: {
      lib: {
        entry,
        formats: ['iife'],
        name: 'VueNativeApp',
        fileName: () => 'main.bundle.js',
      },
      outDir: BUNDLE_DIRECTORY,
      emptyOutDir: false,
      minify: mode === 'production',
      watch,
    },
  }
}

function entryOption(args) {
  const index = args.indexOf('--entry')

  return index === -1 ? frameworkPath('src/entry.ts') : args[index + 1]
}

function startDevServer() {
  const connectedApps = new Set()
  const sendToApps = (message) => connectedApps.forEach((response) => response.write(message))

  function handleEvents(request, response) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    response.write('data: reload\n\n') // a freshly connected app grabs the latest bundle
    connectedApps.add(response)
    request.on('close', () => connectedApps.delete(response))
  }

  function handleBundle(response) {
    response.writeHead(200, { 'Content-Type': 'application/javascript' })
    response.end(readFileSync(BUNDLE_PATH))
  }

  http
    .createServer((request, response) => {
      if (request.url === '/events') handleEvents(request, response)
      else handleBundle(response)
    })
    .listen(PORT, () => console.log(`dev server: http://localhost:${PORT}`))

  // Without a keepalive, URLSession drops the idle connection.
  setInterval(() => sendToApps(':\n\n'), KEEPALIVE_INTERVAL_MS)

  return {
    name: 'vuenative-reload',
    writeBundle() {
      console.log(`reload -> ${connectedApps.size} app(s)`)
      sendToApps('data: reload\n\n')
    },
  }
}

const [command, ...args] = process.argv.slice(2)

if (command === 'dev') {
  const reloadPlugin = startDevServer()
  await build(
    viteConfig({
      mode: 'development',
      entry: entryOption(args),
      plugins: [reloadPlugin],
      watch: {},
    }),
  )
} else if (command === 'build') {
  await build(
    viteConfig({
      mode: args.includes('--production') ? 'production' : 'development',
      entry: entryOption(args),
    }),
  )
} else {
  console.log('usage: vuenative <dev | build> [--entry file] [--production]')
  process.exitCode = 1
}
