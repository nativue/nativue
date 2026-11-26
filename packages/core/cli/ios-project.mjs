// The iOS project files prebuild builds from the config, instead of copying them from the template:
// the Xcode project, Info.plist, the entitlements, and the icon and launch screen. A null file
// removes the template's.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { appResources, iosFonts } from './app-config.mjs'
import { applyMods } from './plugins.mjs'
import { pbxproj, plist } from './serialize.mjs'

const DEPLOYMENT_TARGET = '15.1'
const ENTITLEMENTS_FILE = 'App.entitlements'
const ASSETS = 'App/Assets.xcassets'
const TEMPLATE_LAUNCH_LOGOS = ['logo', 'logo-dark'].flatMap((name) =>
  [1, 2, 3].map((scale) => `${name}@${scale}x.png`),
)
const DEV_SERVER_HOST_SCRIPT = `# Lets a physical device reach the dev server on this Mac.
[ "$CONFIGURATION" = "Debug" ] || exit 0
echo "$(scutil --get LocalHostName).local" > "$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/dev-server-host.txt"
`

// The app's objects keep the ids the hand-written project had.
const ID = {
  product: 'AA0000000000000000000001',
  appFolder: 'AA0000000000000000000002',
  frameworksPhase: 'AA0000000000000000000003',
  mainGroup: 'AA0000000000000000000004',
  productsGroup: 'AA0000000000000000000005',
  target: 'AA0000000000000000000006',
  sourcesPhase: 'AA0000000000000000000007',
  resourcesPhase: 'AA0000000000000000000008',
  project: 'AA0000000000000000000009',
  targetConfigurations: 'AA000000000000000000000A',
  projectConfigurations: 'AA000000000000000000000B',
  projectDebug: 'AA000000000000000000000C',
  projectRelease: 'AA000000000000000000000D',
  targetDebug: 'AA000000000000000000000E',
  targetRelease: 'AA000000000000000000000F',
  pluginsBuildFile: 'AA0000000000000000000010',
  pluginsPackage: 'AA0000000000000000000011',
  pluginsProduct: 'AA0000000000000000000012',
  devServerHostPhase: 'AA0000000000000000000020',
}

function buildPhase(isa) {
  return { isa, buildActionMask: 2147483647, files: [], runOnlyForDeploymentPostprocessing: 0 }
}

function configurationList(configurations) {
  return {
    isa: 'XCConfigurationList',
    buildConfigurations: configurations,
    defaultConfigurationIsVisible: 0,
    defaultConfigurationName: 'Release',
  }
}

function targetBuildSettings(app, hasEntitlements) {
  return {
    ASSETCATALOG_COMPILER_APPICON_NAME: 'AppIcon',
    CODE_SIGN_ENTITLEMENTS: hasEntitlements ? ENTITLEMENTS_FILE : undefined,
    CODE_SIGN_STYLE: 'Automatic',
    CURRENT_PROJECT_VERSION: app.buildNumber,
    DEVELOPMENT_TEAM: app.ios.appleTeamId,
    GENERATE_INFOPLIST_FILE: 'YES',
    INFOPLIST_FILE: 'Info.plist',
    INFOPLIST_KEY_CFBundleDisplayName: app.name,
    LD_RUNPATH_SEARCH_PATHS: '$(inherited) @executable_path/Frameworks',
    MARKETING_VERSION: app.version,
    PRODUCT_BUNDLE_IDENTIFIER: app.ios.bundleIdentifier,
    PRODUCT_NAME: '$(TARGET_NAME)',
    TARGETED_DEVICE_FAMILY: '1,2',
  }
}

function projectObjects(app, hasEntitlements) {
  return {
    [ID.pluginsBuildFile]: { isa: 'PBXBuildFile', productRef: ID.pluginsProduct },
    [ID.product]: {
      isa: 'PBXFileReference',
      explicitFileType: 'wrapper.application',
      includeInIndex: 0,
      path: 'App.app',
      sourceTree: 'BUILT_PRODUCTS_DIR',
    },
    [ID.appFolder]: {
      isa: 'PBXFileSystemSynchronizedRootGroup',
      path: 'App',
      sourceTree: '<group>',
    },
    [ID.frameworksPhase]: {
      ...buildPhase('PBXFrameworksBuildPhase'),
      files: [ID.pluginsBuildFile],
    },
    [ID.mainGroup]: {
      isa: 'PBXGroup',
      children: [ID.appFolder, ID.productsGroup],
      sourceTree: '<group>',
    },
    [ID.productsGroup]: {
      isa: 'PBXGroup',
      children: [ID.product],
      name: 'Products',
      sourceTree: '<group>',
    },
    [ID.target]: {
      isa: 'PBXNativeTarget',
      buildConfigurationList: ID.targetConfigurations,
      buildPhases: [ID.sourcesPhase, ID.frameworksPhase, ID.resourcesPhase, ID.devServerHostPhase],
      buildRules: [],
      dependencies: [],
      fileSystemSynchronizedGroups: [ID.appFolder],
      name: 'App',
      packageProductDependencies: [ID.pluginsProduct],
      productName: 'App',
      productReference: ID.product,
      productType: 'com.apple.product-type.application',
    },
    [ID.project]: {
      isa: 'PBXProject',
      attributes: {
        BuildIndependentTargetsInParallel: 1,
        LastSwiftUpdateCheck: 1600,
        LastUpgradeCheck: 1600,
      },
      buildConfigurationList: ID.projectConfigurations,
      developmentRegion: 'en',
      hasScannedForEncodings: 0,
      knownRegions: ['en', 'Base'],
      mainGroup: ID.mainGroup,
      minimizedProjectReferenceProxies: 1,
      packageReferences: [ID.pluginsPackage],
      preferredProjectObjectVersion: 77,
      productRefGroup: ID.productsGroup,
      projectDirPath: '',
      projectRoot: '',
      targets: [ID.target],
    },
    [ID.resourcesPhase]: buildPhase('PBXResourcesBuildPhase'),
    [ID.devServerHostPhase]: {
      ...buildPhase('PBXShellScriptBuildPhase'),
      alwaysOutOfDate: 1,
      inputPaths: [],
      name: 'Write Dev Server Host',
      outputPaths: ['$(TARGET_BUILD_DIR)/$(UNLOCALIZED_RESOURCES_FOLDER_PATH)/dev-server-host.txt'],
      shellPath: '/bin/sh',
      shellScript: DEV_SERVER_HOST_SCRIPT,
    },
    [ID.sourcesPhase]: buildPhase('PBXSourcesBuildPhase'),
    [ID.projectDebug]: {
      isa: 'XCBuildConfiguration',
      buildSettings: {
        ALWAYS_SEARCH_USER_PATHS: 'NO',
        ENABLE_TESTABILITY: 'YES',
        IPHONEOS_DEPLOYMENT_TARGET: DEPLOYMENT_TARGET,
        ONLY_ACTIVE_ARCH: 'YES',
        SDKROOT: 'iphoneos',
        SWIFT_ACTIVE_COMPILATION_CONDITIONS: 'DEBUG',
        SWIFT_OPTIMIZATION_LEVEL: '-Onone',
        SWIFT_VERSION: '5.0',
      },
      name: 'Debug',
    },
    [ID.projectRelease]: {
      isa: 'XCBuildConfiguration',
      buildSettings: {
        ALWAYS_SEARCH_USER_PATHS: 'NO',
        IPHONEOS_DEPLOYMENT_TARGET: DEPLOYMENT_TARGET,
        SDKROOT: 'iphoneos',
        SWIFT_COMPILATION_MODE: 'wholemodule',
        SWIFT_VERSION: '5.0',
        VALIDATE_PRODUCT: 'YES',
      },
      name: 'Release',
    },
    [ID.targetDebug]: {
      isa: 'XCBuildConfiguration',
      buildSettings: targetBuildSettings(app, hasEntitlements),
      name: 'Debug',
    },
    [ID.targetRelease]: {
      isa: 'XCBuildConfiguration',
      buildSettings: targetBuildSettings(app, hasEntitlements),
      name: 'Release',
    },
    [ID.targetConfigurations]: configurationList([ID.targetDebug, ID.targetRelease]),
    [ID.projectConfigurations]: configurationList([ID.projectDebug, ID.projectRelease]),
    [ID.pluginsPackage]: { isa: 'XCLocalSwiftPackageReference', relativePath: 'NativuePlugins' },
    [ID.pluginsProduct]: { isa: 'XCSwiftPackageProductDependency', productName: 'NativuePlugins' },
  }
}

const COMMENTS = {
  [ID.product]: 'App.app',
  [ID.appFolder]: 'App',
  [ID.frameworksPhase]: 'Frameworks',
  [ID.productsGroup]: 'Products',
  [ID.target]: 'App',
  [ID.sourcesPhase]: 'Sources',
  [ID.resourcesPhase]: 'Resources',
  [ID.project]: 'Project object',
  [ID.targetConfigurations]: 'Build configuration list for PBXNativeTarget "App"',
  [ID.projectConfigurations]: 'Build configuration list for PBXProject "App"',
  [ID.projectDebug]: 'Debug',
  [ID.projectRelease]: 'Release',
  [ID.targetDebug]: 'Debug',
  [ID.targetRelease]: 'Release',
  [ID.pluginsBuildFile]: 'NativuePlugins in Frameworks',
  [ID.pluginsPackage]: 'XCLocalSwiftPackageReference "NativuePlugins"',
  [ID.pluginsProduct]: 'NativuePlugins',
  [ID.devServerHostPhase]: 'Write Dev Server Host',
}

function isDictionary(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The app's keys win over nativue's; dictionaries in both are merged, lists joined without repeats. */
function mergeDictionaries(base, overrides = {}) {
  const keys = [...new Set([...Object.keys(base), ...Object.keys(overrides)])]

  return Object.fromEntries(
    keys.map((key) => {
      const [value, override] = [base[key], overrides[key]]
      const merged =
        isDictionary(value) && isDictionary(override)
          ? mergeDictionaries(value, override)
          : Array.isArray(value) && Array.isArray(override)
            ? [...new Set([...value, ...override])]
            : (override ?? value)

      return [key, merged]
    }),
  )
}

/** nativue's keys, then the plugins', then the app's. */
function infoPlist(app, plugins, context) {
  const fonts = iosFonts(appResources(app, plugins))
  const base = { ...nativueInfoPlist(app), ...(fonts.length > 0 && { UIAppFonts: fonts }) }
  const document = applyMods(plugins, 'ios', 'infoPlist', base, context)

  return mergeDictionaries(document, app.ios.infoPlist)
}

function entitlements(app, plugins, context) {
  return mergeDictionaries(
    applyMods(plugins, 'ios', 'entitlements', {}, context),
    app.ios.entitlements,
  )
}

function nativueInfoPlist(app) {
  return {
    CFBundleURLTypes: [
      { CFBundleURLName: app.ios.bundleIdentifier, CFBundleURLSchemes: app.schemes },
    ],
    NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
    NSLocalNetworkUsageDescription:
      'Connects to the Nativue dev server on your Mac for hot reload.',
    UILaunchScreen: { UIColorName: 'LaunchBackground', UIImageName: 'LaunchLogo' },
  }
}

const DARK_APPEARANCE = [{ appearance: 'luminosity', value: 'dark' }]
const ASSET_INFO = { author: 'xcode', version: 1 }

function assetJson(contents) {
  return `${JSON.stringify(contents, null, 2)}\n`
}

function colorComponents(hex) {
  const [red, green, blue] = [1, 3, 5].map((start) =>
    (parseInt(hex.slice(start, start + 2), 16) / 255).toFixed(3),
  )

  return { 'color-space': 'srgb', components: { red, green, blue, alpha: '1.000' } }
}

function launchBackground(splash) {
  return assetJson({
    colors: [
      { color: colorComponents(splash.backgroundColor), idiom: 'universal' },
      {
        appearances: DARK_APPEARANCE,
        color: colorComponents(splash.darkBackgroundColor),
        idiom: 'universal',
      },
    ],
    info: ASSET_INFO,
  })
}

/** The template's logo, or the app's: one 360px image, shown at 120 points (@3x). */
function launchLogoFiles(splash, readAppFile) {
  if (!splash.image) return {}

  const directory = `${ASSETS}/LaunchLogo.imageset`
  const removed = Object.fromEntries(
    TEMPLATE_LAUNCH_LOGOS.map((file) => [`${directory}/${file}`, null]),
  )
  const contents = {
    images: [
      { filename: 'logo@3x.png', idiom: 'universal', scale: '3x' },
      {
        appearances: DARK_APPEARANCE,
        filename: 'logo-dark@3x.png',
        idiom: 'universal',
        scale: '3x',
      },
    ],
    info: ASSET_INFO,
  }

  return {
    ...removed,
    [`${directory}/Contents.json`]: assetJson(contents),
    [`${directory}/logo@3x.png`]: { content: readAppFile(splash.image) },
    [`${directory}/logo-dark@3x.png`]: { content: readAppFile(splash.darkImage) },
  }
}

/** In the app's buildable folder, so Xcode copies them to the bundle's root. */
function resourceFiles(resources, readAppFile) {
  return Object.fromEntries(
    resources
      .filter(({ ios }) => ios)
      .map(({ source, ios }) => [
        `App/Resources/${ios.destination}`,
        { content: readAppFile(source) },
      ]),
  )
}

/** Paths relative to ios/. */
export function iosProjectFiles(app, appDirectory, plugins = []) {
  const readAppFile = (path) => readFileSync(resolve(appDirectory, path))
  const context = { config: app, projectRoot: appDirectory }
  const appEntitlements = entitlements(app, plugins, context)
  const hasEntitlements = Object.keys(appEntitlements).length > 0
  const project = {
    objectVersion: 77,
    objects: projectObjects(app, hasEntitlements),
    rootObject: ID.project,
    comments: COMMENTS,
  }

  return {
    'App.xcodeproj/project.pbxproj': pbxproj(project),
    'Info.plist': plist(infoPlist(app, plugins, context)),
    ...(hasEntitlements && { [ENTITLEMENTS_FILE]: plist(appEntitlements) }),
    ...(app.icon && {
      [`${ASSETS}/AppIcon.appiconset/icon.png`]: { content: readAppFile(app.icon) },
    }),
    [`${ASSETS}/LaunchBackground.colorset/Contents.json`]: launchBackground(app.splash),
    ...launchLogoFiles(app.splash, readAppFile),
    ...resourceFiles(appResources(app, plugins), readAppFile),
  }
}
