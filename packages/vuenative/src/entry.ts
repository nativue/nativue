// The app's entry, added by the CLI: every .vue file under the project's src/app/ is a route
// (like expo-router), so projects have no main.js.
import { createRouterApp } from './router'

createRouterApp(import.meta.glob('/src/app/**/*.vue', { eager: true })).mount()
