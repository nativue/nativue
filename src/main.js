import { createRouterApp } from 'vuenative/router'

createRouterApp(import.meta.glob('./app/**/*.vue', { eager: true })).mount()
