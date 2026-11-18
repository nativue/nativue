import type { Plugin as VitePlugin } from 'vite'

/**
 * A plugin of nativue.config.ts, e.g. @nativue/tailwind: build-time work through Vite plugins, and a
 * module the app imports before it runs.
 */
export interface NativuePlugin {
  name: string
  /** Added to the bundler's (Vite's) plugins. */
  vite?: VitePlugin | VitePlugin[]
  /** Imported before the app runs, resolved from the app: a package path or a virtual module. */
  runtime?: string
}

export interface NativueConfig {
  plugins?: NativuePlugin[]
}

export function defineConfig(config: NativueConfig): NativueConfig
