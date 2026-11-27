package dev.nativue.notifications

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** A scheduled notification's alarm went off. */
class NotificationReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra(Scheduler.ID_EXTRA) ?: return

        Scheduler(context.applicationContext).fire(id)
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

        Scheduler(context.applicationContext).setAlarmsAgain()
    }
}
