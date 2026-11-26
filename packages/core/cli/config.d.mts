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

/** A value of Info.plist or the entitlements. */
export type PlistValue = string | number | boolean | PlistValue[] | { [key: string]: PlistValue }

/** nativue.config.ts: the app, which `nativue prebuild` generates ios/ and android/ from. */
export interface GeneratedProjectsConfig {
  prebuild?: true
  /** Shown under the app's icon. */
  name: string
  /** Deep links open the app: `myapp://...`. Several, e.g. to keep an old one working. */
  scheme: string | string[]
  /** Shown to people, three numbers: '1.2.0'. Defaults to '1.0.0'. */
  version?: string
  /** Raised for every release the stores get: CFBundleVersion and versionCode. Defaults to 1. */
  buildNumber?: number
  /** A 1024×1024 PNG, relative to the app. */
  icon?: string
  /** The launch screen: a logo on a color. */
  splash?: {
    /** A 360×360 PNG, shown 120 points wide. */
    image?: string
    /** In dark mode; defaults to image. */
    darkImage?: string
    /** e.g. '#F1F5F9'; defaults to white. */
    backgroundColor?: string
    /** Defaults to backgroundColor. */
    darkBackgroundColor?: string
  }
  ios: {
    /** e.g. com.company.myapp */
    bundleIdentifier: string
    /** Signs the app for phones: the team id under Signing & Capabilities in Xcode. */
    appleTeamId?: string
    /** Keys added to Info.plist, e.g. { NSCameraUsageDescription: 'Scans receipts' }. */
    infoPlist?: Record<string, PlistValue>
    /** e.g. { 'aps-environment': 'development' } */
    entitlements?: Record<string, PlistValue>
  }
  android: {
    /** The applicationId and the Kotlin package, e.g. com.company.myapp: no hyphens. */
    package: string
    /** e.g. ['android.permission.CAMERA'] */
    permissions?: string[]
    /** Android 8+'s icon: a square PNG whose logo fits in the middle 61%, on a color. */
    adaptiveIcon?: { foregroundImage: string; backgroundColor?: string }
    /**
     * Signs release builds. The passwords are read when Gradle builds, from a Gradle property
     * (~/.gradle/gradle.properties) or an environment variable of these names.
     */
    signing?: {
      /** Outside android/, e.g. './credentials/upload.keystore' */
      storeFile: string
      keyAlias: string
      storePasswordEnv: string
      keyPasswordEnv: string
    }
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
