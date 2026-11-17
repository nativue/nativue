// Dev server: rebuilds on save and tells the app (via SSE) to reload the bundle.
import { build } from 'vite'
import http from 'node:http'
import { readFileSync } from 'node:fs'

const PORT = 42883 // #42b883, Vue's green
const BUNDLE_PATH = 'ios/VueNative/main.bundle.js'
const KEEPALIVE_INTERVAL_MS = 15000
const connectedApps = new Set()

function sendToApps(message) {
  connectedApps.forEach((response) => response.write(message))
}

function notifyReload() {
  sendToApps('data: reload\n\n')
}

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

await build({
  mode: 'development',
  build: { watch: {} },
  plugins: [
    {
      name: 'vuenative-reload',
      writeBundle() {
        console.log(`reload -> ${connectedApps.size} app(s)`)
        notifyReload()
      },
    },
  ],
})
