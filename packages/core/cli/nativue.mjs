#!/usr/bin/env node
// The nativue CLI, run from the app's folder:
//   nativue build                  bundles src/app/ into ios/App/main.bundle.js (and, with an android/
//                                    folder, android/app/src/main/assets/main.bundle.js; Hermes bytecode
//                                    with --production)
//   nativue dev                    rebuilds on save and tells the app (via SSE) to reload the bundle
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSymbolicator } from './symbolicate.mjs'

const PORT = 42883 // #42b883, Vue's green
const BUNDLE_DIRECTORY = 'ios/App'
const BUNDLE_PATH = `${BUNDLE_DIRECTORY}/main.bundle.js`
const SOURCE_MAP_PATH = `${BUNDLE_PATH}.map`
const ANDROID_ASSETS_DIRECTORY = 'android/app/src/main/assets'
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

// hermesc ships with the hermes-compiler package, one binary per host system.
const HERMESC_BY_PLATFORM = {
  darwin: 'osx-bin/hermesc',
  linux: 'linux64-bin/hermesc',
  win32: 'win64-bin/hermesc.exe',
}

function hermescPath() {
  const packageDirectory = dirname(
    createRequire(import.meta.url).resolve('hermes-compiler/package.json'),
  )

  return `${packageDirectory}/hermesc/${HERMESC_BY_PLATFORM[process.platform]}`
}

// The Android app packages its assets folder, so it gets the bundle. A production one is compiled
// to Hermes bytecode, which starts faster: no parsing when the app opens. The runtime tells
// bytecode from source on its own, so the file keeps its name.
function bundleForAndroid(mode) {
  return {
    name: 'nativue-android-bundle',
    writeBundle() {
      if (!existsSync('android')) return

      const androidBundlePath = `${ANDROID_ASSETS_DIRECTORY}/main.bundle.js`
      mkdirSync(ANDROID_ASSETS_DIRECTORY, { recursive: true })

      if (mode !== 'production') return copyFileSync(BUNDLE_PATH, androidBundlePath)

      execFileSync(
        hermescPath(),
        ['-emit-binary', '-O', '-w', '-out', androidBundlePath, BUNDLE_PATH],
        {
          stdio: 'inherit',
        },
      )
    },
  }
}

function viteConfig({ mode, plugins = [], watch = null, sourcemap = false }) {
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
      bundleForAndroid(mode),
      ...plugins,
    ],
    // Compiled templates and app code import from 'vue': point them to the native renderer.
    resolve: {
      alias: [
        { find: /^vue$/, replacement: frameworkPath('src/renderer.ts') },
        { find: /^@nativue\/core\/router$/, replacement: frameworkPath('src/router.ts') },
        { find: /^@\//, replacement: `${process.cwd()}/src/` },
      ],
    },
    define: { 'process.env.NODE_ENV': JSON.stringify(mode) },
    build: {
      lib: {
        entry: frameworkPath('src/entry.ts'),
        formats: ['iife'],
        name: 'NativueApp',
        fileName: () => 'main.bundle.js',
      },
      outDir: BUNDLE_DIRECTORY,
      emptyOutDir: false,
      minify: mode === 'production',
      sourcemap,
      watch,
    },
  }
}

function startDevServer() {
  const connectedApps = new Set()
  let symbolicate = (text) => text
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

  // The app posts an error's stack; it gets it back pointing at the app's files.
  async function handleSymbolicate(request, response) {
    let text = ''
    for await (const chunk of request) text += chunk

    response.writeHead(200, { 'Content-Type': 'text/plain' })
    response.end(symbolicate(text))
  }

  http
    .createServer((request, response) => {
      if (request.url === '/events') handleEvents(request, response)
      else if (request.url === '/symbolicate') handleSymbolicate(request, response)
      else handleBundle(response)
    })
    .listen(PORT, () => console.log(`dev server: http://localhost:${PORT}`))

  // Without a keepalive, URLSession drops the idle connection.
  setInterval(() => sendToApps(':\n\n'), KEEPALIVE_INTERVAL_MS)

  return {
    name: 'nativue-reload',
    // The source map stays in memory: removed from ios/App, so the app never ships it.
    writeBundle() {
      symbolicate = createSymbolicator(
        JSON.parse(readFileSync(SOURCE_MAP_PATH, 'utf8')),
        BUNDLE_DIRECTORY,
      )
      rmSync(SOURCE_MAP_PATH)

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
      plugins: [reloadPlugin],
      watch: {},
      sourcemap: 'hidden', // no comment in the bundle: the dev server serves the map
    }),
  )
} else if (command === 'build') {
  await build(
    viteConfig({
      mode: args.includes('--production') ? 'production' : 'development',
    }),
  )
} else {
  console.log('usage: nativue <dev | build> [--production]')
  process.exitCode = 1
}
