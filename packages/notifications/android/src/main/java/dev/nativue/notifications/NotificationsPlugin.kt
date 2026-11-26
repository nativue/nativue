package dev.nativue.notifications

import android.Manifest
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.core.app.NotificationManagerCompat
import dev.nativue.ActivityListener
import dev.nativue.NativuePlugin
import dev.nativue.PluginRegistry
import org.json.JSONObject

/** Notifications.* (src/index.ts): alarms that post notifications, and the taps that open the app. */
class NotificationsPlugin : NativuePlugin, ActivityListener {
    private lateinit var registry: PluginRegistry
    private val scheduler by lazy { Scheduler(registry.applicationContext) }
    /** The last tap, kept until JavaScript reads it: one that opens the app comes before JavaScript runs. */
    @Volatile
    private var lastResponse: Map<String, Any?>? = null

    override fun register(registry: PluginRegistry) {
        this.registry = registry

        registry.addAsyncFunction("notifications.getPermission") { _, promise -> promise.resolve(permission()) }

        registry.addAsyncFunction("notifications.requestPermission") { _, promise ->
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return@addAsyncFunction promise.resolve(permission())

            registry.permissions.request(listOf(Manifest.permission.POST_NOTIFICATIONS)) { promise.resolve(permission()) }
        }

        registry.addAsyncFunction("notifications.openSettings") { _, promise ->
            val activity = registry.requireActivity()
            val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)
            } else {
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.fromParts("package", activity.packageName, null))
            }

            activity.startActivity(intent)
            promise.resolve()
        }

        registry.addAsyncFunction("notifications.schedule") { arguments, promise ->
            val notification = JSONObject(arguments[0] as Map<*, *>)
            val trigger = (arguments.getOrNull(1) as? Map<*, *>)?.let(::JSONObject)

            scheduler.schedule(notification, trigger)
            promise.resolve(notification.getString("id"))
        }

        registry.addAsyncFunction("notifications.cancel") { arguments, promise ->
            scheduler.cancel(arguments[0] as String)
            promise.resolve()
        }

        registry.addAsyncFunction("notifications.cancelAll") { _, promise ->
            scheduler.cancelAll()
            promise.resolve()
        }

        registry.addAsyncFunction("notifications.getScheduled") { _, promise ->
            val scheduled = scheduler.all().map { entry ->
                val notification = entry.getJSONObject("notification")

                mapOf(
                    "id" to notification.getString("id"),
                    "content" to Scheduler.toMap(notification),
                    "trigger" to Scheduler.toMap(entry.getJSONObject("trigger")),
                )
            }

            promise.resolve(scheduled)
        }

        registry.addAsyncFunction("notifications.getLastResponse") { _, promise ->
            promise.resolve(lastResponse)
            lastResponse = null
        }

        registry.addFunction("notifications.setForegroundPresentation") { arguments ->
            val presentation = arguments[0] as Map<*, *>

            Scheduler.foregroundBanner = presentation["banner"] as? Boolean ?: true
            Scheduler.foregroundSound = presentation["sound"] as? Boolean ?: true
            null
        }

        registry.addAsyncFunction("notifications.setChannel") { arguments, promise ->
            val channel = arguments[0] as Map<*, *>

            scheduler.setChannel(
                channel["id"] as String,
                channel["name"] as String,
                channel["description"] as? String ?: "",
                channel["importance"] as? String ?: "default",
            )
            promise.resolve()
        }
    }

    override fun onActivityCreated(activity: ComponentActivity) {
        readTap(activity.intent)
        activity.addOnNewIntentListener(::readTap)
    }

    /**
     * Each tap once: Android gives the same intent again to a recreated activity, from Recents, and
     * after the process died, so the taps read are kept.
     */
    private fun readTap(intent: Intent) {
        val notification = intent.getStringExtra(Scheduler.TAP_EXTRA) ?: return
        val token = intent.getStringExtra(Scheduler.TAP_TOKEN_EXTRA) ?: return
        val readTaps = registry.applicationContext.getSharedPreferences("dev.nativue.notifications.taps", Context.MODE_PRIVATE)

        if (readTaps.contains(token)) return

        // ponytail: never pruned; a few dozen bytes per tap, add a cap if apps tap thousands.
        readTaps.edit().putBoolean(token, true).apply()

        val response = mapOf("notification" to Scheduler.toMap(JSONObject(notification)), "tapId" to token)

        lastResponse = response
        registry.sendEvent("notifications.response", response)
    }

    /** Android 13+ asks; before, notifications are on unless the user turned them off in Settings. */
    private fun permission(): Map<String, Any> {
        val enabled = NotificationManagerCompat.from(registry.applicationContext).areNotificationsEnabled()

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || !enabled && isGranted()) {
            return mapOf("status" to if (enabled) "granted" else "denied", "granted" to enabled, "canAskAgain" to enabled)
        }

        return registry.permissions.status(listOf(Manifest.permission.POST_NOTIFICATIONS))
    }

    private fun isGranted() = registry.permissions.status(listOf(Manifest.permission.POST_NOTIFICATIONS))["granted"] == true
}
