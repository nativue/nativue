// Applied by the app's settings.gradle.kts: the Android side of the app's packages, those whose
// package.json has
//   "nativue": { "android": { "sources": "android", "plugin": "dev.nativue.haptics.HapticsPlugin" } }
// becomes modules the app depends on (sources: the folder with build.gradle.kts, which depends on
// project(":nativue")). The app's own native code, native/<name>/android, is compiled into the app;
// its plugin is <Name>Plugin, with no package, and native/<name>/nativue.json can list the Maven
// libraries it uses: { "android": { "dependencies": ["com.squareup.okhttp3:okhttp:4.12.0"] } }.
// The plugin classes reach the app as the string resource nativue_plugins.
import groovy.json.JsonSlurper
import java.io.File

@Suppress("UNCHECKED_CAST")
fun readJson(file: File): Map<String, Any?> = JsonSlurper().parse(file) as Map<String, Any?>

/** node_modules/<name>, looked up the way Node does: in the app's folder, then in its parents. */
fun packageDirectory(name: String, appDirectory: File): File? =
    generateSequence(appDirectory) { it.parentFile }
        .map { File(it, "node_modules/$name") }
        .firstOrNull { File(it, "package.json").isFile }

fun dependencyNames(packageJson: Map<String, Any?>, keys: List<String>): List<String> =
    keys.flatMap { (packageJson[it] as? Map<*, *>)?.keys.orEmpty() }.map { it.toString() }

data class AndroidPlugin(val projectPath: String, val pluginClass: String)

/**
 * The app's packages with an Android side, then theirs, as cli/link.mjs finds them: a package made for
 * nativue brings the native packages it depends on (@nativue/icons brings @nativue/svg).
 */
fun androidPlugins(appDirectory: File): List<AndroidPlugin> {
    val appPackage = readJson(File(appDirectory, "package.json"))
    val pending = ArrayDeque(dependencyNames(appPackage, listOf("dependencies", "devDependencies")).map { it to appDirectory })
    val visited = mutableSetOf<String>()
    val plugins = mutableListOf<AndroidPlugin>()

    while (pending.isNotEmpty()) {
        val (name, fromDirectory) = pending.removeFirst()
        if (!visited.add(name)) continue

        val directory = packageDirectory(name, fromDirectory) ?: continue
        val packageJson = readJson(File(directory, "package.json"))
        val nativue = packageJson["nativue"] as? Map<*, *>
        val isForNativue = nativue != null || (packageJson["peerDependencies"] as? Map<*, *>)?.containsKey("@nativue/core") == true

        androidPlugin(name, directory, nativue)?.let(plugins::add)
        if (isForNativue) dependencyNames(packageJson, listOf("dependencies")).forEach { pending.add(it to directory) }
    }

    return plugins
}

fun androidPlugin(name: String, directory: File, nativue: Map<*, *>?): AndroidPlugin? {
    val android = nativue?.get("android") as? Map<*, *> ?: return null
    val projectPath = ":" + name.removePrefix("@").replace('/', '-')

    include(projectPath)
    project(projectPath).projectDir = File(directory, android["sources"] as String)

    return AndroidPlugin(projectPath, android["plugin"] as String)
}

/** 'face-id' -> 'FaceId', as the CLI names the iOS side. */
fun pascalCase(name: String): String =
    name.split(Regex("[^a-zA-Z0-9]+")).filter { it.isNotEmpty() }.joinToString("") { it.replaceFirstChar(Char::uppercaseChar) }

val appDirectory: File = settingsDir.parentFile
val androidPlugins = androidPlugins(appDirectory)
val appSourceDirectories = File(appDirectory, "native").listFiles().orEmpty()
    // native/extensions holds iOS extension targets, not modules.
    .filter { it.name != "extensions" }
    .sortedBy { it.name }
    .map { File(it, "android") }
    .filter { it.isDirectory }
val appPluginClasses = appSourceDirectories.map { pascalCase(it.parentFile.name) + "Plugin" }
val appLibraries = appSourceDirectories
    .map { File(it.parentFile, "nativue.json") }
    .filter { it.isFile }
    .flatMap { ((readJson(it)["android"] as? Map<*, *>)?.get("dependencies") as? List<*>).orEmpty() }
    .map { it.toString() }
    .distinct()
val pluginClasses = androidPlugins.map { it.pluginClass } + appPluginClasses

// Through Groovy's dynamic calls: the Android Gradle plugin's types aren't on a settings script's classpath.
gradle.beforeProject {
    if (path != ":app") return@beforeProject

    pluginManager.withPlugin("com.android.application") {
        androidPlugins.forEach { plugin -> dependencies.add("implementation", project(plugin.projectPath)) }
        appLibraries.forEach { library -> dependencies.add("implementation", library) }

        extensions.getByName("android").withGroovyBuilder {
            "getBuildFeatures"()!!.withGroovyBuilder { "setResValues"(true) }
            "getDefaultConfig"()!!.withGroovyBuilder {
                "resValue"("string", "nativue_plugins", pluginClasses.joinToString(","))
            }
            "getSourceSets"()!!.withGroovyBuilder {
                "getByName"("main")!!.withGroovyBuilder {
                    // Kotlin and Java: each source set compiles only its own language.
                    listOf("getKotlin", "getJava").forEach { sourceSet ->
                        sourceSet()!!.withGroovyBuilder { appSourceDirectories.forEach { "srcDir"(it) } }
                    }
                }
            }
        }
    }
}
