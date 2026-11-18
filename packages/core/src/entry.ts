// The app's entry, added by the CLI: every .vue file under the project's src/app/ is a route, so
// projects have no main.js. The runtime modules of nativue.config's plugins run first. An optional
// src/app.ts sets the app up before it mounts (app.use for Vue plugins, app.provide...).
import 'virtual:nativue/plugin-runtimes'
import type { App } from 'vue'
import { createRouterApp } from './router'

type AppSetup = { default?: (app: App) => void }

const app = createRouterApp(import.meta.glob('/src/app/**/*.vue', { eager: true }))
const setupFiles = import.meta.glob<AppSetup>('/src/app.{ts,js}', { eager: true })

Object.values(setupFiles).forEach((setupFile) => setupFile.default?.(app))
app.mount()
