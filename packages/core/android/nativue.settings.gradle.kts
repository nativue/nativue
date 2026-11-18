// Applied by the app's settings.gradle.kts: the Android side of the app's packages, those whose
// package.json has
//   "nativue": { "android": { "sources": "android", "plugin": "dev.nativue.haptics.HapticsPlugin" } }
// becomes modules the app depends on (sources: the folder with build.gradle.kts, which depends on
// project(":nativue")). The plugin classes reach the app as the string resource nativue_plugins.
import groovy.json.JsonSlurper
import java.io.File

@Suppress("UNCHECKED_CAST")
fun readJson(file: File): Map<String, Any?> = JsonSlurper().parse(file) as Map<String, Any?>

/** node_modules/<name>, looked up the way Node does: in the app's folder, then in its parents. */
fun packageDirectory(name: String, appDirectory: File): File? =
    generateSequence(appDirectory) { it.parentFile }
        .map { File(it, "node_modules/$name") }
        .firstOrNull { File(it, "package.json").isFile }

fun dependencyNames(appDirectory: File): List<String> {
    val appPackage = readJson(File(appDirectory, "package.json"))

    return listOf("dependencies", "devDependencies").flatMap { (appPackage[it] as? Map<*, *>)?.keys.orEmpty() }
        .map { it.toString() }
}

data class AndroidPlugin(val projectPath: String, val pluginClass: String)

fun androidPlugin(name: String, appDirectory: File): AndroidPlugin? {
    val directory = packageDirectory(name, appDirectory) ?: return null
    val nativue = readJson(File(directory, "package.json"))["nativue"] as? Map<*, *>
    val android = nativue?.get("android") as? Map<*, *> ?: return null
    val projectPath = ":" + name.removePrefix("@").replace('/', '-')

    include(projectPath)
    project(projectPath).projectDir = File(directory, android["sources"] as String)

    return AndroidPlugin(projectPath, android["plugin"] as String)
}

val appDirectory: File = settingsDir.parentFile
val androidPlugins = dependencyNames(appDirectory).mapNotNull { name -> androidPlugin(name, appDirectory) }

// Through Groovy's dynamic calls: the Android Gradle plugin's types aren't on a settings script's classpath.
gradle.beforeProject {
    if (path != ":app") return@beforeProject

    pluginManager.withPlugin("com.android.application") {
        androidPlugins.forEach { plugin -> dependencies.add("implementation", project(plugin.projectPath)) }

        extensions.getByName("android").withGroovyBuilder {
            "getBuildFeatures"()!!.withGroovyBuilder { "setResValues"(true) }
            "getDefaultConfig"()!!.withGroovyBuilder {
                "resValue"("string", "nativue_plugins", androidPlugins.joinToString(",") { it.pluginClass })
            }
        }
    }
}
