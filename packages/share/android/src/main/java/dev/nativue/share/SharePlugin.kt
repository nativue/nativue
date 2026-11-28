package dev.nativue.share

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.webkit.MimeTypeMap
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import dev.nativue.ActivityListener
import dev.nativue.NativuePlugin
import dev.nativue.PluginRegistry
import dev.nativue.Promise
import java.io.File

/**
 * Share (src/index.ts): the system's chooser. Android says which app was chosen, through the IntentSender
 * the chooser is given, but not whether the user sent it there. Files go as content:// URIs of the
 * package's provider, readable by the chosen app only.
 */
class SharePlugin : NativuePlugin, ActivityListener {
    private lateinit var registry: PluginRegistry
    private val mainThread = Handler(Looper.getMainLooper())
    private var chooserLauncher: ActivityResultLauncher<Intent>? = null
    /** The call the open chooser answers; null once answered, or once its JavaScript is gone. */
    private var waiting: Promise? = null
    private var isListeningForChoices = false

    private class ShareError(val code: String, message: String) : Exception(message)

    private val choiceReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val component = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                intent.getParcelableExtra(Intent.EXTRA_CHOSEN_COMPONENT, ComponentName::class.java)
            } else {
                @Suppress("DEPRECATION")
                intent.getParcelableExtra(Intent.EXTRA_CHOSEN_COMPONENT)
            }

            answer(completed = true, app = component?.packageName)
        }
    }

    override fun register(registry: PluginRegistry) {
        this.registry = registry
        // Called again for each new activity: the receiver is registered once, for the whole process.
        if (!isListeningForChoices) {
            ContextCompat.registerReceiver(
                registry.applicationContext,
                choiceReceiver,
                IntentFilter(choiceAction()),
                ContextCompat.RECEIVER_NOT_EXPORTED,
            )
            isListeningForChoices = true
        }

        registry.addAsyncFunction("share.share") { arguments, promise ->
            @Suppress("UNCHECKED_CAST")
            val content = arguments[0] as Map<String, Any?>

            mainThread.post { share(content, promise) }
        }
    }

    // Registered on every creation, in the same order, as activity results require.
    override fun onActivityCreated(activity: ComponentActivity) {
        chooserLauncher = activity.registerForActivityResult(StartActivityForResult()) {
            val closed = waiting

            // A choice arrives as a broadcast, which can come just after the chooser closes.
            mainThread.postDelayed({ if (waiting === closed) answer(completed = false, app = null) }, CHOICE_WAIT_MS)
        }
    }

    // Its JavaScript goes with it: there's no one left to answer.
    override fun onActivityDestroyed(activity: ComponentActivity) {
        waiting = null
    }

    private fun share(content: Map<String, Any?>, promise: Promise) {
        val launcher = chooserLauncher

        if (waiting != null) return promise.reject("ERR_UNAVAILABLE", "The share sheet is already open")
        if (launcher == null) return promise.reject("ERR_UNAVAILABLE", "The app has no activity open")

        try {
            val dialogTitle = (content["dialogTitle"] as? String).orEmpty()
            val chooser = Intent.createChooser(sendIntent(content), dialogTitle.ifEmpty { null }, choiceSender())

            waiting = promise
            launcher.launch(chooser)
        } catch (error: ShareError) {
            promise.reject(error.code, error.message ?: "")
        }
    }

    private fun answer(completed: Boolean, app: String?) {
        waiting?.resolve(mapOf("completed" to completed, "app" to app))
        waiting = null
    }

    /** Text and link together, as Android's share has one text: the link after the text. */
    private fun sendIntent(content: Map<String, Any?>): Intent {
        val files = (content["files"] as? List<*>).orEmpty().map { contentUri(it as String) }
        val text = listOf(content["text"], content["url"]).mapNotNull { (it as? String)?.ifEmpty { null } }.joinToString("\n")
        val subject = (content["subject"] as? String).orEmpty()
        val mimeType = (content["mimeType"] as? String).orEmpty()
        val intent = if (files.size > 1) {
            Intent(Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList(files.map { it.uri }))
        } else {
            Intent(Intent.ACTION_SEND).apply { files.firstOrNull()?.let { putExtra(Intent.EXTRA_STREAM, it.uri) } }
        }

        if (text.isNotEmpty()) intent.putExtra(Intent.EXTRA_TEXT, text)
        if (subject.isNotEmpty()) intent.putExtra(Intent.EXTRA_SUBJECT, subject)
        intent.type = mimeType.ifEmpty { if (files.isEmpty()) "text/plain" else commonType(files.map { it.mimeType }) }
        if (files.isNotEmpty()) {
            // The chooser passes the read permission on to the chosen app, for these URIs only.
            intent.clipData = ClipData.newRawUri("", files.first().uri).apply {
                files.drop(1).forEach { addItem(ClipData.Item(it.uri)) }
            }
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }

        return intent
    }

    private class SharedFile(val uri: Uri, val mimeType: String)

    private fun contentUri(fileUri: String): SharedFile {
        val context = registry.applicationContext
        val file = File(Uri.decode(fileUri.removePrefix("file://")))

        if (!file.isFile) throw ShareError("ERR_NOT_FOUND", "${file.path} doesn't exist")

        val uri = try {
            FileProvider.getUriForFile(context, "${context.packageName}.nativue.share", file)
        } catch (error: IllegalArgumentException) {
            throw ShareError("ERR_INVALID_ARGUMENT", "Only files in the app's folders (Paths.document, Paths.cache) can be shared")
        }
        val mimeType = MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension.lowercase()) ?: "application/octet-stream"

        return SharedFile(uri, mimeType)
    }

    /** One type for them all: the same one, the same family (image/star), or anything (star/star). */
    private fun commonType(mimeTypes: List<String>): String {
        val families = mimeTypes.map { it.substringBefore('/') }.toSet()

        return when {
            mimeTypes.toSet().size == 1 -> mimeTypes.first()
            families.size == 1 -> "${families.first()}/*"
            else -> "*/*"
        }
    }

    /** What the chooser sends, with the chosen app, when the user picks one. Mutable: the chooser adds to it. */
    private fun choiceSender() = PendingIntent.getBroadcast(
        registry.applicationContext,
        0,
        Intent(choiceAction()).setPackage(registry.applicationContext.packageName),
        PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0),
    ).intentSender

    private fun choiceAction() = "${registry.applicationContext.packageName}.nativue.share.CHOSEN"

    private companion object {
        const val CHOICE_WAIT_MS = 500L
    }
}
