package dev.nativue.imagepicker

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.core.content.FileProvider
import dev.nativue.ActivityListener
import dev.nativue.NativuePlugin
import dev.nativue.PluginRegistry
import dev.nativue.Promise
import java.io.File
import java.util.concurrent.Executors
import org.json.JSONArray
import org.json.JSONObject

/**
 * ImagePicker (src/index.ts): the system's photo picker, which needs no permission, and the camera app
 * (ACTION_IMAGE_CAPTURE, ACTION_VIDEO_CAPTURE), which writes into a file the app lends it. Android may close the app while
 * either is open: what comes back then is kept until getPendingResult reads it.
 */
class ImagePickerPlugin : NativuePlugin, ActivityListener {
    private lateinit var registry: PluginRegistry
    private val mainThread = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private val files by lazy { MediaFiles(registry.applicationContext) }
    private val preferences by lazy { registry.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE) }
    private var pickLauncher: ActivityResultLauncher<PickRequest>? = null
    private var cameraLauncher: ActivityResultLauncher<CaptureRequest>? = null
    /** The call the open picker or camera answers; null once its activity, and the JavaScript with it, is gone. */
    private var waiting: Waiting? = null

    /** [limit]: 0 for no limit. */
    private class Waiting(val promise: Promise, val isCamera: Boolean, val limit: Int = 1)

    override fun register(registry: PluginRegistry) {
        this.registry = registry

        registry.addAsyncFunction("imagePicker.pick") { arguments, promise ->
            val request = PickRequest((arguments[0] as Number).toInt(), arguments[1] as String)

            mainThread.post {
                launch(Waiting(promise, isCamera = false, request.limit)) {
                    (pickLauncher ?: throw IllegalStateException("The app has no activity open")).launch(request)
                }
            }
        }

        // Android's camera app takes a photo or a video, never a choice of both: 'all' takes a photo.
        registry.addAsyncFunction("imagePicker.openCamera") { arguments, promise ->
            val isVideo = arguments[0] == "videos"
            val videoMaxDuration = (arguments[1] as Number).toInt()
            val isLowQuality = arguments[2] == "low"

            mainThread.post {
                withCameraPermission(promise) {
                    launch(Waiting(promise, isCamera = true)) { openCamera(isVideo, videoMaxDuration, isLowQuality) }
                }
            }
        }

        registry.addAsyncFunction("imagePicker.getCameraPermission") { _, promise ->
            promise.resolve(if (declaresCamera()) registry.permissions.status(CAMERA) else GRANTED)
        }

        registry.addAsyncFunction("imagePicker.requestCameraPermission") { _, promise ->
            if (declaresCamera()) registry.permissions.request(CAMERA) { promise.resolve(it) } else promise.resolve(GRANTED)
        }

        registry.addAsyncFunction("imagePicker.getPendingResult") { _, promise ->
            worker.execute {
                val pending = preferences.getString(PENDING_RESULT, null)

                preferences.edit().remove(PENDING_RESULT).commit()
                promise.resolve(pending?.let(::mediaList))
            }
        }
    }

    // Registered on every creation, in the same order: a result for the activity Android closed reaches these.
    override fun onActivityCreated(activity: ComponentActivity) {
        pickLauncher = activity.registerForActivityResult(PickMedia()) { uris ->
            // The documents screen, where there's no photo picker, takes no limit.
            finish(isCamera = false) { limit -> uris.take(if (limit > 0) limit else uris.size).mapNotNull(files::copy) }
        }
        cameraLauncher = activity.registerForActivityResult(CaptureMedia()) { result -> finish(isCamera = true) { takenMedia(result) } }
    }

    // Its JavaScript goes with it: what the picker or camera returns is then kept for getPendingResult.
    override fun onActivityDestroyed(activity: ComponentActivity) {
        waiting = null
    }

    private fun launch(next: Waiting, open: () -> Unit) {
        if (waiting != null) return next.promise.reject("ERR_UNAVAILABLE", "The picker or the camera is already open")

        waiting = next
        try {
            open()
        } catch (error: Exception) {
            waiting = null
            next.promise.reject("ERR_UNAVAILABLE", error.message ?: "Couldn't open it")
        }
    }

    /** The file's path is kept first: if Android closes the app meanwhile, the result still finds it. */
    private fun openCamera(isVideo: Boolean, videoMaxDuration: Int, isLowQuality: Boolean) {
        val context = registry.applicationContext
        val launcher = cameraLauncher

        if (launcher == null || !context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)) {
            throw IllegalStateException("This device has no camera")
        }

        val file = files.newFile(if (isVideo) "mp4" else "jpg")
        val output = FileProvider.getUriForFile(context, "${context.packageName}.nativue.imagepicker", file)

        preferences.edit().putString(CAMERA_FILE, file.path).commit()
        launcher.launch(CaptureRequest(output, isVideo, videoMaxDuration, isLowQuality))
    }

    /** Some camera apps record videos where they like and only return where: then it's copied from there. */
    private fun takenMedia(result: CaptureResult): List<Map<String, Any>> {
        val file = preferences.getString(CAMERA_FILE, null)?.let(::File)

        preferences.edit().remove(CAMERA_FILE).commit()
        if (!result.isTaken || file == null) return emptyList()
        if (file.length() > 0) return listOf(files.describe(file, if (file.extension == "mp4") "video/mp4" else "image/jpeg"))

        file.delete()

        return listOfNotNull(result.elsewhere?.let(files::copy))
    }

    /**
     * A manifest that declares CAMERA (for another feature) makes the camera app refuse until it's granted,
     * so it's asked first. Without it, the camera app needs no permission.
     */
    private fun withCameraPermission(promise: Promise, open: () -> Unit) {
        if (!declaresCamera()) return open()

        registry.permissions.request(CAMERA) { response ->
            if (response["granted"] == true) open()
            else promise.reject("ERR_PERMISSION_DENIED", "The camera permission was refused")
        }
    }

    /** [result] gets the limit of the call it answers: 0 when none waits. */
    private fun finish(isCamera: Boolean, result: (limit: Int) -> List<Map<String, Any>>) {
        val answering = waiting?.takeIf { it.isCamera == isCamera }

        waiting = null
        worker.execute {
            try {
                val media = result(answering?.limit ?: 0)

                when {
                    answering == null -> keepPending(media)
                    isCamera -> answering.promise.resolve(media.firstOrNull())
                    else -> answering.promise.resolve(media)
                }
            } catch (error: Exception) {
                answering?.promise?.reject("ERR_UNAVAILABLE", error.message ?: "Couldn't read what was chosen")
            }
        }
    }

    private fun keepPending(media: List<Map<String, Any>>) {
        if (media.isEmpty()) return

        val json = JSONArray(media.map { JSONObject(it) }).toString()

        preferences.edit().putString(PENDING_RESULT, json).commit()
    }

    private fun mediaList(json: String): List<Map<String, Any>> {
        val array = JSONArray(json)

        return (0 until array.length()).map { index ->
            val item = array.getJSONObject(index)

            item.keys().asSequence().associateWith { item.get(it) }
        }
    }

    private fun declaresCamera(): Boolean {
        val context = registry.applicationContext
        val packageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.packageManager.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(PackageManager.GET_PERMISSIONS.toLong()))
        } else {
            @Suppress("DEPRECATION")
            context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS)
        }

        return packageInfo.requestedPermissions?.contains(Manifest.permission.CAMERA) == true
    }

    private companion object {
        const val PREFERENCES = "nativue.image-picker"
        const val CAMERA_FILE = "cameraFile"
        const val PENDING_RESULT = "pendingResult"
        val CAMERA = listOf(Manifest.permission.CAMERA)
        val GRANTED = mapOf("status" to "granted", "granted" to true, "canAskAgain" to true)
    }
}
