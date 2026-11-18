#!/usr/bin/env node
// The nativue CLI, run from the app's folder:
//   nativue build                  bundles src/app/ into ios/App/main.bundle.js (and, with an android/
//                                    folder, android/app/src/main/assets/main.bundle.js); Hermes bytecode
//                                    with --production
//   nativue dev                    rebuilds on save and tells the app (via SSE) to reload the bundle
//   nativue run <ios | android>    builds, installs and opens the app on a simulator or emulator, then
//                                    keeps going as `nativue dev` (unless one is already running)
import { build, loadConfigFromFile } from 'vite'
import vue from '@vitejs/plugin-vue'
import http from 'node:http'
import net from 'node:net'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { linkIosPlugins } from './link.mjs'
import { runOnAndroid, runOnIOS } from './run.mjs'
import { createSymbolicator } from './symbolicate.mjs'

const PORT = 40836 // 0x9F84, from #0E9F84, the nativue green
const MAX_STACK_LENGTH = 1_000_000 // characters, of a stack the app posts to /symbolicate
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

// Hermes bytecode starts faster: no parsing when the app opens. The runtime tells bytecode from
// source on its own, so the file keeps its name.
function compileToBytecode(bundlePath) {
  const bytecodePath = `${bundlePath}.hbc`

  execFileSync(hermescPath(), ['-emit-binary', '-O', '-w', '-out', bytecodePath, bundlePath], {
    stdio: 'inherit',
  })
  renameSync(bytecodePath, bundlePath)
}

// A production bundle becomes bytecode; the Android app packages its assets folder, so it gets a copy.
function finishBundle(mode) {
  return {
    name: 'nativue-finish-bundle',
    writeBundle() {
      if (mode === 'production') compileToBytecode(BUNDLE_PATH)
      if (!existsSync('android')) return

      mkdirSync(ANDROID_ASSETS_DIRECTORY, { recursive: true })
      copyFileSync(BUNDLE_PATH, `${ANDROID_ASSETS_DIRECTORY}/main.bundle.js`)
    },
  }
}

const CONFIG_FILES = [
  'nativue.config.ts',
  'nativue.config.mts',
  'nativue.config.js',
  'nativue.config.mjs',
]
const PLUGIN_RUNTIMES_MODULE = 'virtual:nativue/plugin-runtimes'

// nativue.config.ts, when the app has one (see config.d.mts).
async function loadAppConfig() {
  const configFile = CONFIG_FILES.find((file) => existsSync(file))
  if (!configFile) return {}

  const { config } = await loadConfigFromFile(
    { command: 'build', mode: 'development' },
    configFile,
    process.cwd(),
    'silent',
  )

  return config
}

// The entry imports this module first: it imports each plugin's runtime module.
function pluginRuntimes(plugins) {
  const resolvedId = `\0${PLUGIN_RUNTIMES_MODULE}`
  const imports = plugins
    .filter((plugin) => plugin.runtime)
    .map((plugin) => `import ${JSON.stringify(plugin.runtime)}`)

  return {
    name: 'nativue-plugin-runtimes',
    resolveId: (id) => (id === PLUGIN_RUNTIMES_MODULE ? resolvedId : null),
    load: (id) => (id === resolvedId ? imports.join('\n') : null),
  }
}

const { plugins: appPlugins = [] } = await loadAppConfig()
const APP_VITE_PLUGINS = [
  pluginRuntimes(appPlugins),
  ...appPlugins.flatMap((plugin) => plugin.vite ?? []),
]

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
      ...APP_VITE_PLUGINS,
      finishBundle(mode),
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
    // An installed app can ask before Vite's first build has written it.
    if (!existsSync(BUNDLE_PATH)) {
      response.writeHead(503, { 'Content-Type': 'text/plain' })
      response.end('The bundle is still building')
      return
    }

    response.writeHead(200, { 'Content-Type': 'application/javascript' })
    response.end(readFileSync(BUNDLE_PATH))
  }

  // The app posts an error's stack; it gets it back pointing at the app's files.
  async function handleSymbolicate(request, response) {
    try {
      let text = ''
      for await (const chunk of request) {
        text += chunk
        if (text.length > MAX_STACK_LENGTH) throw new Error('stack too long')
      }

      response.writeHead(200, { 'Content-Type': 'text/plain' })
      response.end(symbolicate(text))
    } catch {
      response.writeHead(400).end() // an aborted or oversized post: never take the server down
    }
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

async function dev() {
  const reloadPlugin = startDevServer()
  await build(
    viteConfig({
      mode: 'development',
      plugins: [reloadPlugin],
      watch: {},
      sourcemap: 'hidden', // no comment in the bundle: the dev server serves the map
    }),
  )
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, () => server.close(() => resolve(true)))
  })
}

const RUNNERS = { ios: runOnIOS, android: runOnAndroid }

async function runApp(platform) {
  await build(viteConfig({ mode: 'development' }))
  await RUNNERS[platform]()

  if (await isPortFree(PORT)) return dev()

  console.log('\nA dev server is already running: the app reloads from it.')
}

const [command, ...args] = process.argv.slice(2)

try {
  if (['dev', 'build', 'run'].includes(command)) linkIosPlugins(frameworkPath(''))

  if (command === 'dev') {
    await dev()
  } else if (command === 'build') {
    await build(
      viteConfig({
        mode: args.includes('--production') ? 'production' : 'development',
      }),
    )
  } else if (command === 'run' && RUNNERS[args[0]]) {
    await runApp(args[0])
  } else {
    console.log('usage: nativue <dev | build [--production] | run <ios | android>>')
    process.exitCode = 1
  }
} catch (error) {
  console.error(`\n${error.message}`)
  process.exitCode = 1
}
