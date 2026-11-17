// Dev server: rebuilda no save e avisa o app (SSE) para recarregar o bundle.
import { build } from 'vite'
import http from 'node:http'
import { readFileSync } from 'node:fs'

const PORT = 42883 // #42b883, o verde do Vue
const BUNDLE = 'ios/VueNative/main.bundle.js'
const clients = new Set()
const reload = () => clients.forEach((c) => c.write('data: reload\n\n'))

http
  .createServer((req, res) => {
    if (req.url === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      res.write('data: reload\n\n') // app recém-conectado pega o bundle mais novo
      clients.add(res)
      req.on('close', () => clients.delete(res))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/javascript' })
    res.end(readFileSync(BUNDLE))
  })
  .listen(PORT, () => console.log(`dev server: http://localhost:${PORT}`))

// keepalive: sem isso o URLSession derruba a conexão ociosa
setInterval(() => clients.forEach((c) => c.write(':\n\n')), 15000)

await build({
  build: { watch: {} },
  plugins: [{ name: 'vuenative-reload', writeBundle: () => { console.log(`reload -> ${clients.size} app(s)`); reload() } }],
})
