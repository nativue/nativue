#!/usr/bin/env node
// The nativue CLI, run from the app's folder:
//   nativue prebuild [ios | android] [--force]
//                                  generates ios/ and android/ from nativue.config.ts (dev, build and
//                                    run do it first); --force discards changes made to them by hand
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
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, watch } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { styleText } from 'node:util'
import { compileToBytecode } from './hermes.mjs'
import { hotPrelude } from './hot-prelude.mjs'
import { resolvePlugins } from './plugins.mjs'
import { linkNativePackages, PLATFORMS, prebuild } from './prebuild.mjs'
import { runOnAndroid, runOnIOS } from './run.mjs'
import { createSymbolicator, framedFiles } from './symbolicate.mjs'

const PORT = 40836 // 0x9F84, from #0E9F84, the nativue green
const MAX_POST_LENGTH = 1_000_000 // characters, of what the app posts: a stack, console output
const LOG_COLORS = { info: 'blue', debug: 'gray', warn: 'yellow', error: 'red' }
const PLATFORM_WIDTH = 'android'.length
const BUNDLE_DIRECTORY = 'ios/App'
const BUNDLE_PATH = `${BUNDLE_DIRECTORY}/main.bundle.js`
const ANDROID_ASSETS_DIRECTORY = 'android/app/src/main/assets'
const KEEPALIVE_INTERVAL_MS = 15000
const UNANSWERED_UPDATE_TIMEOUT_MS = 10000
// What a release build leaves out: logs slow the JavaScript thread and land in the device's log, which
// Android keeps readable. warn and error stay, for problems in the field.
const DEVELOPMENT_CONSOLE_METHODS = [
  'log',
  'info',
  'debug',
  'trace',
  'table',
  'dir',
  'group',
  'groupCollapsed',
  'groupEnd',
]

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
]

function frameworkPath(relativePath) {
  return fileURLToPath(new URL(`../${relativePath}`, import.meta.url))
}

// hermesc ships with the hermes-compiler package, one binary per host system.
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

const appConfig = await loadAppConfig()
const appPlugins = await resolvePlugins(process.cwd(), appConfig.plugins).catch((error) => {
  console.error(`\n${error.message}`)
  process.exit(1)
})
const APP_VITE_PLUGINS = [
  pluginRuntimes(appPlugins),
  ...appPlugins.flatMap((plugin) => plugin.vite ?? []),
]

/**
 * Each method an empty function the minifier then drops with its call, even where the call's value is
 * used (`onPress: () => console.log(item)`). Arguments that do something still run.
 */
function withoutDevelopmentLogs() {
  return Object.fromEntries(
    DEVELOPMENT_CONSOLE_METHODS.map((method) => [`console.${method}`, '(() => {})']),
  )
}

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
    // Compiled templates and app code import from 'vue': point them to the native renderer. A package
    // installed from a folder with its own node_modules gets the app's @nativue/core too, not a second one.
    resolve: {
      alias: [
        { find: /^vue$/, replacement: frameworkPath('src/renderer.ts') },
        { find: /^@nativue\/core$/, replacement: frameworkPath('src/renderer.ts') },
        { find: /^@nativue\/core\/router$/, replacement: frameworkPath('src/router.ts') },
        { find: /^@\//, replacement: `${process.cwd()}/src/` },
      ],
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode),
      ...(mode === 'production' ? withoutDevelopmentLogs() : {}),
    },
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

// Vite's full bundle mode builds the app and, on save, a patch with the changed modules. Each app
// runtime is a Vite client: the dev server speaks Vite's protocol for it and relays updates over SSE.
async function dev() {
  const connectedApps = new Set()
  // A source map, read once until the code changes: every message to the apps is a reload, an update
  // or a keepalive.
  const sourceMapsByFile = new Map()
  const sendToApps = (message) => {
    sourceMapsByFile.clear()
    connectedApps.forEach((response) => response.write(message))
  }
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
    // Hot updates leave the bundle Vite serves behind: a reload would run the code from before them.
    await vite.environments.client.bundledDev.devEngine.ensureLatestBuildOutput()
    const bundle = await fetch(`${viteURL}/assets/entry.js`)
    if (!bundle.ok) {
      response.writeHead(503, { 'Content-Type': 'text/plain' })
      response.end('The bundle is still building')
      return
    }

    const clientId = randomUUID()
    connectToVite(clientId)
    const body = hotPrelude(clientId, `http://${request.headers.host}`) + (await bundle.text())
    response.writeHead(200, {
      'Content-Type': 'application/javascript',
      'Content-Length': Buffer.byteLength(body),
    })
    response.end(body)
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

  function cachedSourceMapOf(file) {
    if (!sourceMapsByFile.has(file)) {
      const sourceMap = sourceMapOf(file)

      sourceMapsByFile.set(file, sourceMap)
      sourceMap.catch(() => sourceMapsByFile.delete(file))
    }

    return sourceMapsByFile.get(file)
  }

  /** The text with its stack frames pointing at the app's files. */
  async function symbolicate(text) {
    const files = [...framedFiles(text)]

    if (files.length === 0) return text

    const sourceMaps = await Promise.all(files.map(cachedSourceMapOf))
    const symbolicateFrames = createSymbolicator(
      Object.fromEntries(
        files.map((file, index) => [file, sourceMaps[index]]).filter(([, map]) => map),
      ),
    )

    return symbolicateFrames(text)
  }

  // The app posts an error's stack; it gets it back pointing at the app's files.
  async function handleSymbolicate(request, response) {
    const text = await symbolicate(await readBody(request))

    response.writeHead(200, { 'Content-Type': 'text/plain' })
    response.end(text)
  }

  // What the app's console prints (hot-client.js).
  async function handleLog(request, response) {
    const { platform, entries } = JSON.parse(await readBody(request))

    // Without a source map (Vite restarting), a stack prints as the app sent it.
    for (const { level, text } of entries) {
      printLog(platform, level, await symbolicate(text).catch(() => text))
    }
    response.writeHead(204).end()
  }

  const routes = {
    '/events': handleEvents,
    '/bundle.js': handleBundle,
    '/hot': handleHotMessage,
    '/symbolicate': handleSymbolicate,
    '/log': handleLog,
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

  if (process.stdin.isTTY) {
    console.log('press r to reload the app')
    process.stdin.setRawMode(true)
    process.stdin.on('data', (key) => {
      if (key[0] === 3) process.exit(130) // ctrl+c, which raw mode turns into a key
      if (key.toString() === 'r') reloadApps()
    })
  }

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

/** Each line after the first starts under the first's text, past the platform. */
function printLog(platform, level, text) {
  const color = LOG_COLORS[level]
  const aligned = text.replaceAll('\n', `\n${' '.repeat(PLATFORM_WIDTH + 1)}`)

  console.log(
    `${styleText('dim', platform.padEnd(PLATFORM_WIDTH))} ${color ? styleText(color, aligned) : aligned}`,
  )
}

async function readBody(request) {
  let text = ''
  for await (const chunk of request) {
    text += chunk
    if (text.length > MAX_POST_LENGTH) throw new Error('body too long')
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

// The platforms dev and build generate: iOS needs a Mac, where its projects build.
const LOCAL_PLATFORMS = process.platform === 'darwin' ? PLATFORMS : ['android']

/** ios/ and android/ from nativue.config.ts, or, with `prebuild: false`, only the packages' links. */
function generateNativeProjects(platforms, { force = false } = {}) {
  const directories = { appDirectory: process.cwd(), coreDirectory: frameworkPath('') }
  const changedPaths =
    appConfig.prebuild === false
      ? linkNativePackages({ ...directories, config: appConfig, plugins: appPlugins, platforms })
      : prebuild({ ...directories, config: appConfig, plugins: appPlugins, platforms, force })

  if (changedPaths.length > 0) console.log(`prebuild: ${changedPaths.length} file(s) updated`)
}

const [command, ...args] = process.argv.slice(2)

try {
  if (command === 'dev' || command === 'build') generateNativeProjects(LOCAL_PLATFORMS)
  if (command === 'run' && RUNNERS[args[0]]) generateNativeProjects([args[0]])

  if (command === 'prebuild') {
    if (appConfig.prebuild === false) {
      throw new Error(
        'nativue.config.ts has prebuild: false, so the app keeps ios/ and android/ by hand.',
      )
    }

    const platforms = PLATFORMS.filter((platform) => args.includes(platform))
    generateNativeProjects(platforms.length > 0 ? platforms : PLATFORMS, {
      force: args.includes('--force'),
    })
  } else if (command === 'dev') {
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
      'usage: nativue <prebuild [ios | android] [--force] | dev | build [--production] | run <ios | android> [--device [name or id]] [--no-dev]>',
    )
    process.exitCode = 1
  }
} catch (error) {
  console.error(`\n${error.message}`)
  process.exitCode = 1
}
