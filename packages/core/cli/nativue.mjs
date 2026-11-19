#!/usr/bin/env node
// The nativue CLI, run from the app's folder:
//   nativue build                  bundles src/app/ into ios/App/main.bundle.js (and, with an android/
//                                    folder, android/app/src/main/assets/main.bundle.js); Hermes bytecode
//                                    with --production
//   nativue dev                    serves the app and updates it on save, keeping its state where it can
//   nativue run <ios | android>    builds, installs and opens the app on a simulator or emulator, then
//                                    keeps going as `nativue dev` (unless one is already running);
//                                    --device for a phone, --device <name or id> for a given one;
//                                    --no-dev only opens the app
import { build, createServer, loadConfigFromFile, transformWithOxc } from 'vite'
import vue from '@vitejs/plugin-vue'
import http from 'node:http'
import net from 'node:net'
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  watch,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { linkIosPlugins } from './link.mjs'
import { runOnAndroid, runOnIOS } from './run.mjs'
import { createSymbolicator, framedFiles } from './symbolicate.mjs'

const PORT = 40836 // 0x9F84, from #0E9F84, the nativue green
const MAX_STACK_LENGTH = 1_000_000 // characters, of a stack the app posts to /symbolicate
const BUNDLE_DIRECTORY = 'ios/App'
const BUNDLE_PATH = `${BUNDLE_DIRECTORY}/main.bundle.js`
const ANDROID_ASSETS_DIRECTORY = 'android/app/src/main/assets'
const KEEPALIVE_INTERVAL_MS = 15000
const UNANSWERED_UPDATE_TIMEOUT_MS = 10000

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

// A .vue file's <style> would become CSS that native views never read: warn instead of dropping it
// silently, once per file, and leave the CSS out of the build.
function ignoreStyleBlocks() {
  const warnedFiles = new Set()

  return {
    name: 'nativue-ignore-style-blocks',
    enforce: 'pre',
    load(id) {
      if (!id.includes('?vue&type=style')) return null

      const file = relative(process.cwd(), id.split('?')[0])
      if (!warnedFiles.has(file)) {
        warnedFiles.add(file)
        this.warn(
          `${file}: <style> blocks aren't supported, native views don't read CSS. Use StyleSheet or @nativue/tailwind instead: https://github.com/nativue/nativue/blob/main/docs/styling.md`,
        )
      }

      return ''
    },
  }
}

// `async function*` or an `async *method()`.
const ASYNC_GENERATOR = /\basync\s+function\s*\*|\basync\s*\*\s*[\w$[#"']/

// Hermes runs no async generators (libraries like axios have them): a file that has one is lowered to
// ES2017, where Oxc rewrites them on top of plain generators. Only those files, so the rest keeps its
// modern syntax.
function lowerAsyncGenerators() {
  return {
    name: 'nativue-lower-async-generators',
    enforce: 'post',
    async transform(code, id) {
      if (!ASYNC_GENERATOR.test(code)) return null

      const { code: lowered, map } = await transformWithOxc(code, id.split('?')[0], {
        lang: 'js',
        target: 'es2017',
        sourcemap: true,
      })

      return { code: lowered, map }
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

function viteConfig({ mode, plugins = [] }) {
  // Vite reads the mode from NODE_ENV: development builds keep each component's file (for errors).
  process.env.NODE_ENV = mode

  return {
    configFile: false,
    root: process.cwd(),
    mode,
    plugins: [
      vue({
        template: {
          compilerOptions: {
            isCustomElement: (tag) => NATIVE_COMPONENT_TAGS.includes(tag),
            // Long static runs would become an HTML string for innerHTML, which native views can't take.
            hoistStatic: false,
          },
        },
      }),
      ignoreStyleBlocks(),
      lowerAsyncGenerators(),
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
    },
  }
}

// Full bundle mode skips the plugins' handleHotUpdate. @vitejs/plugin-vue's tells a template-only change
// apart, so the component re-renders and keeps its state, and tells the app which file changed: run it
// for every change, before it's rebuilt.
function vueHotUpdates(sendToApps) {
  let vuePlugin

  return {
    name: 'nativue-vue-hot-updates',

    configResolved(config) {
      vuePlugin = config.plugins.find((plugin) => plugin.name === 'vite:vue')
    },

    async watchChange(file) {
      if (!existsSync(file)) return

      await vuePlugin.handleHotUpdate({
        file,
        modules: [],
        read: () => readFileSync(file, 'utf8'),
        server: { ws: { send: sendToApps } },
      })
    },
  }
}

function hotPrelude(clientId, serverURL) {
  const viteRequire = createRequire(createRequire(import.meta.url).resolve('vite'))
  const runtime = readFileSync(viteRequire.resolve('rolldown/experimental/runtime'), 'utf8')
  const client = readFileSync(frameworkPath('cli/hot-client.js'), 'utf8')
  const options = JSON.stringify({ clientId, serverURL })

  return `${runtime.replace(/^export \{[^}]*\};?$/m, '')}\nvar __NATIVUE_HOT__ = ${options};\n${client}\n`
}

// Vite's full bundle mode builds the app and, on save, a patch with the changed modules. Each app
// runtime is a Vite client: the dev server speaks Vite's protocol for it and relays updates over SSE.
async function dev() {
  const connectedApps = new Set()
  const sendToApps = (message) => connectedApps.forEach((response) => response.write(message))
  const config = viteConfig({
    mode: 'development',
    plugins: [vueHotUpdates((payload) => sendToApps(`data: hot ${JSON.stringify(payload)}\n\n`))],
  })
  const vite = await createServer({
    ...config,
    experimental: { bundledDev: true },
    server: { host: '127.0.0.1', port: PORT + 1, watch: {} },
    build: {
      ...config.build,
      lib: false,
      rolldownOptions: {
        input: frameworkPath('src/entry.ts'),
        experimental: { devMode: { lazy: false } },
      },
    },
  })
  await vite.listen()

  const viteURL = `http://127.0.0.1:${vite.httpServer.address().port}`
  const socketsByClientId = new Map()
  const silenceTimersByClientId = new Map()
  let reloadTimer = null

  function reloadApps() {
    clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => {
      socketsByClientId.forEach((socket) => socket.close())
      socketsByClientId.clear()
      console.log(`reload -> ${connectedApps.size} app(s)`)
      sendToApps('data: reload\n\n')
    }, 50)
  }

  function sendToVite(clientId, message) {
    const socket = socketsByClientId.get(clientId)
    if (!socket) return

    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
    else socket.addEventListener('open', () => socket.send(JSON.stringify(message)), { once: true })
  }

  function disconnect(clientId) {
    socketsByClientId.get(clientId)?.close()
    socketsByClientId.delete(clientId)
  }

  // A runtime replaced since (the app reopened or reconnected) never answers an update: forget its client.
  function expectAnswer(clientId) {
    if (silenceTimersByClientId.has(clientId)) return

    silenceTimersByClientId.set(
      clientId,
      setTimeout(() => disconnect(clientId), UNANSWERED_UPDATE_TIMEOUT_MS),
    )
  }

  function connectToVite(clientId) {
    const socket = new WebSocket(
      `${viteURL.replace('http', 'ws')}/?token=${vite.config.webSocketToken}`,
      'vite-hmr',
    )
    socketsByClientId.set(clientId, socket)
    socket.addEventListener('message', ({ data }) => {
      const payload = JSON.parse(data)
      if (payload.type === 'bundled-dev-update') {
        expectAnswer(clientId)
        sendToApps(`data: hot ${JSON.stringify({ ...payload, clientId })}\n\n`)
      } else if (payload.type === 'full-reload' && !payload.ifFallback) {
        reloadApps()
      }
    })
    sendToVite(clientId, { type: 'custom', event: 'vite:client-connected', data: { clientId } })
  }

  function handleEvents(request, response) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    response.write('data: reload\n\n') // a freshly connected app grabs the latest bundle
    connectedApps.add(response)
    request.on('close', () => connectedApps.delete(response))
  }

  async function handleBundle(request, response) {
    const bundle = await fetch(`${viteURL}/assets/entry.js`)
    if (!bundle.ok) {
      response.writeHead(503, { 'Content-Type': 'text/plain' })
      response.end('The bundle is still building')
      return
    }

    const clientId = randomUUID()
    connectToVite(clientId)
    response.writeHead(200, { 'Content-Type': 'application/javascript' })
    response.end(hotPrelude(clientId, `http://${request.headers.host}`) + (await bundle.text()))
  }

  async function handleHotMessage(request, response) {
    const { clientId, message } = JSON.parse(await readBody(request))
    clearTimeout(silenceTimersByClientId.get(clientId))
    silenceTimersByClientId.delete(clientId)
    if (message.event !== 'nativue:received') sendToVite(clientId, message)
    response.writeHead(204).end()
  }

  // A patch: Vite serves it from memory, as an ES module the app evaluates as a script.
  async function handlePatch(request, response) {
    const patch = await fetch(`${viteURL}${request.url}`)
    response.writeHead(patch.status, { 'Content-Type': 'application/javascript' })
    response.end((await patch.text()).replace(/;\s*export \{\}\s*$/, ''))
  }

  async function sourceMapOf(file) {
    if (file === 'main.bundle.js') {
      return {
        sourceMap: await (await fetch(`${viteURL}/assets/entry.js.map`)).json(),
        directory: `${BUNDLE_DIRECTORY}/assets`,
        lineOffset: hotPrelude('', '').split('\n').length - 1,
      }
    }

    const sourceMap = await fetch(`${viteURL}/${file}.map`)

    return sourceMap.ok ? { sourceMap: await sourceMap.json(), directory: BUNDLE_DIRECTORY } : null
  }

  // The app posts an error's stack; it gets it back pointing at the app's files.
  async function handleSymbolicate(request, response) {
    const text = await readBody(request)
    const files = [...framedFiles(text)]
    const sourceMaps = await Promise.all(files.map(sourceMapOf))
    const symbolicate = createSymbolicator(
      Object.fromEntries(
        files.map((file, index) => [file, sourceMaps[index]]).filter(([, map]) => map),
      ),
    )

    response.writeHead(200, { 'Content-Type': 'text/plain' })
    response.end(symbolicate(text))
  }

  const routes = {
    '/events': handleEvents,
    '/bundle.js': handleBundle,
    '/hot': handleHotMessage,
    '/symbolicate': handleSymbolicate,
  }

  http
    .createServer((request, response) => {
      const handle = routes[request.url] ?? handlePatch
      Promise.resolve(handle(request, response)).catch(() => {
        response.writeHead(400).end() // an aborted or oversized post: never take the server down
      })
    })
    // Limitation: Every interface, so phones reach it, and anyone on the network can download the bundle.
    .listen(PORT, () => console.log(`dev server: http://localhost:${PORT}`))

  // The bundle only watches the files it has: one added or removed (a new route) needs a new build.
  // Editors that save by renaming a temporary file keep the file there, which isn't a change.
  const sourceFiles = new Set(readdirSync('src', { recursive: true }))
  let restartTimer = null
  watch('src', { recursive: true }, (_event, file) => {
    if (!file || existsSync(`src/${file}`) === sourceFiles.has(file)) return

    if (sourceFiles.has(file)) sourceFiles.delete(file)
    else sourceFiles.add(file)

    clearTimeout(restartTimer)
    restartTimer = setTimeout(async () => {
      await vite.restart()
      reloadApps()
    }, 100)
  })

  // Without a keepalive, URLSession drops the idle connection.
  setInterval(() => sendToApps(':\n\n'), KEEPALIVE_INTERVAL_MS)
}

async function readBody(request) {
  let text = ''
  for await (const chunk of request) {
    text += chunk
    if (text.length > MAX_STACK_LENGTH) throw new Error('body too long')
  }

  return text
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, () => server.close(() => resolve(true)))
  })
}

const RUNNERS = { ios: runOnIOS, android: runOnAndroid }

// `--device` alone is true; followed by a name or id, that.
function deviceOption(args) {
  const index = args.indexOf('--device')
  if (index === -1) return undefined

  const value = args[index + 1]

  return value === undefined || value.startsWith('--') ? true : value
}

async function runApp(platform, args) {
  await build(viteConfig({ mode: 'development' }))
  await RUNNERS[platform]({ device: deviceOption(args), port: PORT })

  if (args.includes('--no-dev')) return
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
    await runApp(args[0], args.slice(1))
  } else {
    console.log(
      'usage: nativue <dev | build [--production] | run <ios | android> [--device [name or id]] [--no-dev]>',
    )
    process.exitCode = 1
  }
} catch (error) {
  console.error(`\n${error.message}`)
  process.exitCode = 1
}
