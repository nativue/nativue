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

/** nativue.config.ts: the app, which `nativue prebuild` generates ios/ and android/ from. */
export interface GeneratedProjectsConfig {
  prebuild?: true
  /** Shown under the app's icon. */
  name: string
  /** Deep links open the app: `myapp://...`. */
  scheme: string
  ios: {
    /** e.g. com.company.myapp */
    bundleIdentifier: string
    /** Signs the app for phones: the team id under Signing & Capabilities in Xcode. */
    appleTeamId?: string
  }
  android: {
    /** The applicationId and the Kotlin package, e.g. com.company.myapp: no hyphens. */
    package: string
  }
  plugins?: NativuePlugin[]
}

/** An app that keeps ios/ and android/ by hand: nativue only links its packages' native code. */
export interface ManualProjectsConfig {
  prebuild: false
  plugins?: NativuePlugin[]
}

export type NativueConfig = GeneratedProjectsConfig | ManualProjectsConfig

export function defineConfig(config: NativueConfig): NativueConfig
