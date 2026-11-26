package dev.nativue

import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts.RequestMultiplePermissions
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

/**
 * Runtime permissions as JavaScript's PermissionResponse: `{ status, granted, canAskAgain }`, to
 * resolve a Promise with, plus the plugin's own fields. Pass only the permissions this Android
 * version asks for (POST_NOTIFICATIONS is Android 13+).
 */
class Permissions internal constructor(private val registry: PluginRegistry) {
    // Android can't tell "never asked" from "denied for good": both have no rationale to show.
    private val asked = registry.applicationContext.getSharedPreferences("dev.nativue.permissions", Context.MODE_PRIVATE)
    private var launcher: ActivityResultLauncher<Array<String>>? = null
    private var launcherActivity: ComponentActivity? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    /** One system prompt at a time: the others wait their turn. */
    private val waitingRequests = ArrayDeque<Pair<List<String>, (Map<String, Any>) -> Unit>>()

    fun status(permissions: List<String>): Map<String, Any> {
        val context = registry.applicationContext
        val denied = permissions.filter {
            ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED
        }

        if (denied.isEmpty()) return response("granted", canAskAgain = true)
        // A rationale means it was denied once, even when another prompt asked.
        if (denied.any { !asked.getBoolean(it, false) && !showsRationale(it) }) {
            return response("undetermined", canAskAgain = true)
        }
        // Without an activity there's no rationale to read: assume it can still ask.
        if (registry.activity == null) return response("denied", canAskAgain = true)

        return response("denied", canAskAgain = denied.all(::showsRationale))
    }

    /** Shows the system prompt (unless all are granted), then calls onResult on the main thread. */
    fun request(permissions: List<String>, onResult: (Map<String, Any>) -> Unit) {
        mainHandler.post {
            waitingRequests.addLast(permissions to onResult)
            if (waitingRequests.size == 1) launchNext()
        }
    }

    internal fun activityCreated(activity: ComponentActivity) {
        // A result that comes after a recreation reaches this one: the waiting requests outlive the activity.
        launcher = activity.registerForActivityResult(RequestMultiplePermissions(), ::finishRequest)
        launcherActivity = activity
    }

    /** Finished for good, not recreated: a prompt it showed won't answer, so the waiting requests get the status. */
    internal fun activityDestroyed(activity: ComponentActivity) {
        if (activity !== launcherActivity || activity.isChangingConfigurations) return

        launcher = null
        launcherActivity = null
        while (waitingRequests.isNotEmpty()) {
            val (permissions, onResult) = waitingRequests.removeFirst()

            onResult(status(permissions))
        }
    }

    private fun launchNext() {
        val (permissions, onResult) = waitingRequests.firstOrNull() ?: return
        val launcher = launcher

        if (status(permissions)["granted"] == true || launcher == null || registry.activity == null) {
            waitingRequests.removeFirst()
            onResult(status(permissions))
            launchNext()

            return
        }

        launcher.launch(permissions.toTypedArray())
    }

    /**
     * Asked only when the user answered: Android 11+ reports a prompt dismissed with back as denied,
     * but only a real "Don't allow" shows a rationale next time.
     */
    private fun finishRequest(results: Map<String, Boolean>) {
        val (permissions, onResult) = waitingRequests.removeFirstOrNull() ?: return
        val answered = results.filter { (permission, granted) -> granted || showsRationale(permission) }.keys

        asked.edit().apply { answered.forEach { putBoolean(it, true) } }.apply()
        onResult(status(permissions))
        launchNext()
    }

    private fun showsRationale(permission: String): Boolean {
        val activity = registry.activity ?: return false

        return ActivityCompat.shouldShowRequestPermissionRationale(activity, permission)
    }

    private fun response(status: String, canAskAgain: Boolean): Map<String, Any> =
        mapOf("status" to status, "granted" to (status == "granted"), "canAskAgain" to canAskAgain)
}
