// The app's entry, added by the CLI: every .vue file under the project's src/app/ is a route, so
// projects have no main.js. The runtime modules of nativue.config's plugins run first.
import 'virtual:nativue/plugin-runtimes'
import { createRouterApp } from './router'

createRouterApp(import.meta.glob('/src/app/**/*.vue', { eager: true })).mount()
