// The iOS project files prebuild builds from the config, instead of copying them from the template:
// the Xcode project, Info.plist, the entitlements, and the icon and launch screen. A null file
// removes the template's.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import {
  appResources,
  EXTENSION_POINTS,
  iosFonts,
  validateExtensionTargets,
} from './app-config.mjs'
import { applyMods } from './plugins.mjs'
import { toPosixPath } from './link.mjs'
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
  embedExtensionsPhase: 'AA0000000000000000000021',
}
// In PlugIns, where iOS looks for an app's extensions.
const PLUGINS_FOLDER = 13

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

/** A stable id, the same on every prebuild: from the extension's name and the object's role. */
function extensionId(name, role) {
  return createHash('sha256')
    .update(`extension/${name}/${role}`)
    .digest('hex')
    .slice(0, 24)
    .toUpperCase()
}

const EXTENSION_ROLES = [
  'product',
  'folder',
  'target',
  'sourcesPhase',
  'frameworksPhase',
  'resourcesPhase',
  'configurations',
  'debug',
  'release',
  'proxy',
  'dependency',
  'embedBuildFile',
  'settingsException',
]

function extensionIds(name) {
  return Object.fromEntries(EXTENSION_ROLES.map((role) => [role, extensionId(name, role)]))
}

function extensionSupportPath(name, file) {
  return `ExtensionSupport/${name}/${file}`
}

function extensionBuildSettings(app, extension) {
  const { name } = extension

  return {
    CODE_SIGN_ENTITLEMENTS: extension.hasEntitlements
      ? extensionSupportPath(name, `${name}.entitlements`)
      : undefined,
    CODE_SIGN_STYLE: 'Automatic',
    CURRENT_PROJECT_VERSION: app.buildNumber,
    DEVELOPMENT_TEAM: app.ios.appleTeamId,
    GENERATE_INFOPLIST_FILE: 'YES',
    INFOPLIST_FILE: extensionSupportPath(name, 'Info.plist'),
    INFOPLIST_KEY_CFBundleDisplayName: name,
    IPHONEOS_DEPLOYMENT_TARGET: extension.deploymentTarget,
    LD_RUNPATH_SEARCH_PATHS:
      '$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks',
    MARKETING_VERSION: app.version,
    PRODUCT_BUNDLE_IDENTIFIER: `${app.ios.bundleIdentifier}${extension.bundleIdSuffix}`,
    // App<Name>, as for native/ modules: a share extension named Social doesn't hide the framework.
    PRODUCT_MODULE_NAME: `App${name}`,
    PRODUCT_NAME: '$(TARGET_NAME)',
    SKIP_INSTALL: 'YES',
    TARGETED_DEVICE_FAMILY: '1,2',
    ...extension.buildSettings,
  }
}

/** An extension target: its product, its buildable folder, and how the app embeds it. */
function extensionObjects(app, extension) {
  const { name, folder } = extension
  const ids = extensionIds(name)

  return {
    [ids.product]: {
      isa: 'PBXFileReference',
      explicitFileType: 'wrapper.app-extension',
      includeInIndex: 0,
      path: `${name}.appex`,
      sourceTree: 'BUILT_PRODUCTS_DIR',
    },
    [ids.folder]: {
      isa: 'PBXFileSystemSynchronizedRootGroup',
      exceptions: extension.hasSettingsFile ? [ids.settingsException] : undefined,
      path: folder,
      sourceTree: '<group>',
    },
    // nativue.json sets the target up: it isn't one of the extension's resources.
    ...(extension.hasSettingsFile && {
      [ids.settingsException]: {
        isa: 'PBXFileSystemSynchronizedBuildFileExceptionSet',
        membershipExceptions: ['nativue.json'],
        target: ids.target,
      },
    }),
    [ids.sourcesPhase]: buildPhase('PBXSourcesBuildPhase'),
    [ids.frameworksPhase]: buildPhase('PBXFrameworksBuildPhase'),
    [ids.resourcesPhase]: buildPhase('PBXResourcesBuildPhase'),
    [ids.target]: {
      isa: 'PBXNativeTarget',
      buildConfigurationList: ids.configurations,
      buildPhases: [ids.sourcesPhase, ids.frameworksPhase, ids.resourcesPhase],
      buildRules: [],
      dependencies: [],
      fileSystemSynchronizedGroups: [ids.folder],
      name,
      productName: name,
      productReference: ids.product,
      productType: 'com.apple.product-type.app-extension',
    },
    [ids.debug]: {
      isa: 'XCBuildConfiguration',
      buildSettings: extensionBuildSettings(app, extension),
      name: 'Debug',
    },
    [ids.release]: {
      isa: 'XCBuildConfiguration',
      buildSettings: extensionBuildSettings(app, extension),
      name: 'Release',
    },
    [ids.configurations]: configurationList([ids.debug, ids.release]),
    [ids.proxy]: {
      isa: 'PBXContainerItemProxy',
      containerPortal: ID.project,
      proxyType: 1,
      remoteGlobalIDString: ids.target,
      remoteInfo: name,
    },
    [ids.dependency]: { isa: 'PBXTargetDependency', target: ids.target, targetProxy: ids.proxy },
    [ids.embedBuildFile]: {
      isa: 'PBXBuildFile',
      fileRef: ids.product,
      settings: { ATTRIBUTES: ['RemoveHeadersOnCopy'] },
    },
  }
}

function extensionComments(extensions) {
  return Object.fromEntries(
    extensions.flatMap(({ name, folder }) => {
      const ids = extensionIds(name)

      return [
        [ids.product, `${name}.appex`],
        [ids.folder, folder],
        [ids.target, name],
        [ids.sourcesPhase, 'Sources'],
        [ids.frameworksPhase, 'Frameworks'],
        [ids.resourcesPhase, 'Resources'],
        [ids.configurations, `Build configuration list for PBXNativeTarget "${name}"`],
        [ids.debug, 'Debug'],
        [ids.release, 'Release'],
        [ids.proxy, 'PBXContainerItemProxy'],
        [ids.dependency, 'PBXTargetDependency'],
        [ids.embedBuildFile, `${name}.appex in Embed Foundation Extensions`],
        [ids.settingsException, `Exceptions for "${folder}" folder in "${name}" target`],
      ]
    }),
  )
}

/** The app's objects, then each extension's; the app embeds them, built first. */
function projectObjects(app, hasEntitlements, extensions) {
  const objects = appObjects(app, hasEntitlements)
  const ids = extensions.map(({ name }) => extensionIds(name))

  if (extensions.length === 0) return objects

  const appTarget = objects[ID.target]

  objects[ID.mainGroup].children.splice(1, 0, ...ids.map(({ folder }) => folder))
  objects[ID.productsGroup].children.push(...ids.map(({ product }) => product))
  objects[ID.project].targets.push(...ids.map(({ target }) => target))
  appTarget.buildPhases.push(ID.embedExtensionsPhase)
  appTarget.dependencies.push(...ids.map(({ dependency }) => dependency))

  return {
    ...objects,
    [ID.embedExtensionsPhase]: {
      ...buildPhase('PBXCopyFilesBuildPhase'),
      dstPath: '',
      dstSubfolderSpec: PLUGINS_FOLDER,
      files: ids.map(({ embedBuildFile }) => embedBuildFile),
      name: 'Embed Foundation Extensions',
    },
    ...Object.assign({}, ...extensions.map((extension) => extensionObjects(app, extension))),
  }
}

function appObjects(app, hasEntitlements) {
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
  [ID.embedExtensionsPhase]: 'Embed Foundation Extensions',
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

const APP_GROUPS_ENTITLEMENT = 'com.apple.security.application-groups'

function appGroupsEntitlement(app) {
  const appGroups = app.ios.appGroups ?? []

  return appGroups.length > 0 ? { [APP_GROUPS_ENTITLEMENT]: appGroups } : {}
}

function entitlements(app, plugins, context) {
  const document = applyMods(plugins, 'ios', 'entitlements', appGroupsEntitlement(app), context)

  return mergeDictionaries(document, app.ios.entitlements)
}

function readSettings(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`${path}: ${error.message}`, { cause: error })
  }
}

/** native/extensions/<name>: an extension of the app, set up by its nativue.json. */
function appExtensions(appDirectory) {
  const directory = join(appDirectory, 'native', 'extensions')
  // statSync follows links: a linked folder is an extension too.
  const names = readdirSync(directory).filter((name) =>
    statSync(join(directory, name)).isDirectory(),
  )

  return names.map((name) => {
    const settingsPath = join(directory, name, 'nativue.json')

    if (!existsSync(settingsPath)) {
      throw new Error(
        `native/extensions/${name} needs a nativue.json: { "ios": { "target": { "type": "widget", "bundleIdSuffix": ".${name}" } } }`,
      )
    }

    // The folder sets the name and the sources, whatever nativue.json says.
    return {
      ...readSettings(settingsPath).ios?.target,
      name,
      sources: join(directory, name),
      hasSettingsFile: true,
    }
  })
}

/** The plugins' targets mods, then the app's own extensions. */
export function extensionTargets(app, plugins, context) {
  const fromPlugins = applyMods(plugins, 'ios', 'targets', [], context)
  const fromApp = existsSync(join(context.projectRoot, 'native', 'extensions'))
    ? appExtensions(context.projectRoot)
    : []

  const targets = [...fromPlugins, ...fromApp]

  validateExtensionTargets(targets, {
    appDirectory: context.projectRoot,
    appGroups: app.ios.appGroups,
  })

  return targets
}

function extensionInfoPlist(target) {
  const base = { NSExtension: { NSExtensionPointIdentifier: EXTENSION_POINTS[target.type] } }

  return mergeDictionaries(base, target.infoPlist)
}

function extensionEntitlements(app, target) {
  return mergeDictionaries(target.appGroups ? appGroupsEntitlement(app) : {}, target.entitlements)
}

/**
 * The target's buildable folder: Extensions/<name>, a link to its sources, as NativuePlugins links
 * the packages' Swift. Xcode builds and archives through it, and picks up edits to the sources.
 */
function extensionFolder(target, appDirectory) {
  const folder = `Extensions/${target.name}`
  const sources = resolve(appDirectory, target.sources)
  const link = toPosixPath(relative(join(appDirectory, 'ios', 'Extensions'), sources))

  return { folder, files: { [folder]: { symlink: link } } }
}

function extensionFiles(app, extensions) {
  return Object.assign(
    {},
    ...extensions.map((extension) => ({
      [extensionSupportPath(extension.name, 'Info.plist')]: plist(extensionInfoPlist(extension)),
      ...(extension.hasEntitlements && {
        [extensionSupportPath(extension.name, `${extension.name}.entitlements`)]: plist(
          extensionEntitlements(app, extension),
        ),
      }),
      ...extension.files,
    })),
  )
}

function nativueInfoPlist(app) {
  return {
    CFBundleURLTypes: [
      { CFBundleURLName: app.ios.bundleIdentifier, CFBundleURLSchemes: app.schemes },
    ],
    NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
    NSLocalNetworkUsageDescription:
      'Connects to the nativue dev server on your Mac for hot reload.',
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
  const extensions = extensionTargets(app, plugins, context).map((target) => ({
    ...target,
    hasEntitlements: Object.keys(extensionEntitlements(app, target)).length > 0,
    ...extensionFolder(target, appDirectory),
  }))
  const project = {
    objectVersion: 77,
    objects: projectObjects(app, hasEntitlements, extensions),
    rootObject: ID.project,
    comments: { ...COMMENTS, ...extensionComments(extensions) },
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
    ...extensionFiles(app, extensions),
  }
}
