package dev.nativue.notifications

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import dev.nativue.PluginRegistry
import org.json.JSONObject
import java.util.Calendar

/**
 * Scheduled notifications, kept in SharedPreferences so a restart can set their alarms again, and
 * posted by NotificationReceiver when one goes off.
 */
internal class Scheduler(private val context: Context) {
    private val scheduled = context.getSharedPreferences("dev.nativue.notifications.scheduled", Context.MODE_PRIVATE)
    private val alarmManager = context.getSystemService(AlarmManager::class.java)

    fun schedule(notification: JSONObject, trigger: JSONObject?) {
        val id = notification.getString("id")

        cancel(id)
        if (trigger == null) return post(notification)

        val entry = JSONObject().put("notification", notification).put("trigger", trigger)

        setAlarm(id, entry, nextTime(trigger, System.currentTimeMillis()))
    }

    fun cancel(id: String) {
        alarmManager.cancel(alarmIntent(id))
        scheduled.edit().remove(id).apply()
    }

    fun cancelAll() {
        scheduled.all.keys.forEach(::cancel)
    }

    fun all(): List<JSONObject> = scheduled.all.values.map { JSONObject(it as String) }

    /** After a restart, which clears alarms, at the time each was set for: now if it passed meanwhile. */
    fun setAlarmsAgain() {
        val now = System.currentTimeMillis()

        for (entry in all()) {
            val id = entry.getJSONObject("notification").getString("id")

            setAlarm(id, entry, maxOf(entry.getLong("time"), now))
        }
    }

    /** Posts it, then sets the next alarm when it repeats. */
    fun fire(id: String) {
        val entry = scheduled.getString(id, null)?.let(::JSONObject) ?: return
        val trigger = entry.getJSONObject("trigger")
        val repeats = trigger.optString("type") == "daily" || trigger.optBoolean("repeats")

        post(entry.getJSONObject("notification"))
        if (repeats) setAlarm(id, entry, nextTime(trigger, System.currentTimeMillis()))
        else scheduled.edit().remove(id).apply()
    }

    fun setChannel(id: String, name: String, description: String, importance: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        val level = when (importance) {
            "high" -> NotificationManager.IMPORTANCE_HIGH
            "low" -> NotificationManager.IMPORTANCE_LOW
            "min" -> NotificationManager.IMPORTANCE_MIN
            else -> NotificationManager.IMPORTANCE_DEFAULT
        }
        val channel = NotificationChannel(id, name, level).apply { this.description = description }

        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun post(notification: JSONObject) {
        val inFront = ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)

        if (inFront) PluginRegistry.get(context).sendEvent("notifications.received", toMap(notification))
        if (inFront && !foregroundBanner) return
        if (!canPost()) return

        val channelId = notification.optString("channelId").takeIf(::channelExists) ?: DEFAULT_CHANNEL

        if (channelId == DEFAULT_CHANNEL) setChannel(DEFAULT_CHANNEL, "Notifications", "", "default")

        val builder = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(smallIcon())
            .setContentTitle(notification.optString("title"))
            .setContentText(notification.optString("body"))
            .setAutoCancel(true)
            .setContentIntent(tapIntent(notification))
            .setSilent(!notification.optBoolean("sound", true) || (inFront && !foregroundSound))

        iconColor()?.let(builder::setColor)
        try {
            NotificationManagerCompat.from(context).notify(notification.getString("id"), 0, builder.build())
        } catch (error: SecurityException) {
            // The permission was revoked between the check and now.
        }
    }

    /** A channel setChannel never made would drop the notification: it goes to the default one instead. */
    private fun channelExists(channelId: String): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true

        return context.getSystemService(NotificationManager::class.java).getNotificationChannel(channelId) != null
    }

    private fun canPost(): Boolean {
        val permitted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

        return permitted && NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    /** Opens the app, which reads the notification from the intent (NotificationsPlugin). */
    private fun tapIntent(notification: JSONObject): PendingIntent {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)!!
            .putExtra(TAP_EXTRA, notification.toString())
            // Read once: the system gives the same intent again from Recents or after the process died.
            .putExtra(TAP_TOKEN_EXTRA, java.util.UUID.randomUUID().toString())
            // A PendingIntent per notification, even when ids share a hash: categories set them apart,
            // without the data URI that would reach the router as a link.
            .addCategory("dev.nativue.notifications.${notification.getString("id")}")

        return PendingIntent.getActivity(
            context,
            notification.getString("id").hashCode(),
            launch,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    private fun alarmIntent(id: String): PendingIntent {
        val intent = Intent(context, NotificationReceiver::class.java)
            .setData(Uri.fromParts("nativue-notification", id, null))
            .putExtra(ID_EXTRA, id)

        return PendingIntent.getBroadcast(
            context,
            id.hashCode(),
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    /** On time with exactAlarms once the user allows it; otherwise when Android batches it, minutes late at most. */
    /** Kept with the time it's set for, which a restart sets again. */
    private fun setAlarm(id: String, entry: JSONObject, time: Long) {
        val intent = alarmIntent(id)

        scheduled.edit().putString(id, entry.put("time", time).toString()).apply()

        if (canScheduleExact()) alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, time, intent)
        else alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, time, intent)
    }

    private fun canScheduleExact(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return alarmManager.canScheduleExactAlarms()

        // Before Android 12 exact alarms needed no permission: only when the app asked for them.
        val requested = context.packageManager
            .getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS).requestedPermissions

        return requested?.contains("android.permission.SCHEDULE_EXACT_ALARM") == true
    }

    private fun smallIcon(): Int {
        val appIcon = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)

        return if (appIcon != 0) appIcon else R.drawable.nativue_notification_icon
    }

    private fun iconColor(): Int? {
        val colorId = context.resources.getIdentifier("notification_icon_color", "string", context.packageName)

        if (colorId == 0) return null

        // The plugin checks it: a hand-edited strings.xml mustn't crash every notification.
        return runCatching { Color.parseColor(context.getString(colorId)) }.getOrNull()
    }

    companion object {
        const val DEFAULT_CHANNEL = "default"
        const val TAP_EXTRA = "dev.nativue.notifications.tap"
        const val ID_EXTRA = "dev.nativue.notifications.id"
        const val TAP_TOKEN_EXTRA = "dev.nativue.notifications.tapToken"

        /** setForegroundPresentation's, until the app quits, as on iOS. */
        @Volatile
        var foregroundBanner = true

        @Volatile
        var foregroundSound = true

        /** The next time it goes off after `now`. */
        fun nextTime(trigger: JSONObject, now: Long): Long = when (trigger.getString("type")) {
            "seconds" -> now + (trigger.getDouble("seconds") * 1000).toLong()
            "date" -> trigger.getLong("timestamp")
            else -> Calendar.getInstance().apply {
                timeInMillis = now
                set(Calendar.HOUR_OF_DAY, trigger.getInt("hour"))
                set(Calendar.MINUTE, trigger.getInt("minute"))
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
                if (timeInMillis <= now) add(Calendar.DAY_OF_YEAR, 1)
            }.timeInMillis
        }

        /** For JavaScript: JSONObject's values, as maps and lists. */
        fun toMap(json: JSONObject): Map<String, Any?> = json.keys().asSequence().associateWith { key ->
            val value = json.get(key)

            when {
                value == JSONObject.NULL -> null
                value is JSONObject -> toMap(value)
                else -> value
            }
        }
    }
}
