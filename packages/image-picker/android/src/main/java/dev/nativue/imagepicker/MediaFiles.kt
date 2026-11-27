package dev.nativue.imagepicker

import android.content.Context
import android.graphics.BitmapFactory
import android.media.ExifInterface
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.webkit.MimeTypeMap
import java.io.File
import java.util.UUID

/** Picked and taken photos and videos as files in the app's cache, and what JavaScript gets for each. */
internal class MediaFiles(private val context: Context) {
    private val directory = File(context.cacheDir, "nativue-image-picker")

    fun newFile(extension: String): File {
        directory.mkdirs()

        return File(directory, "${UUID.randomUUID()}.$extension")
    }

    /** The picker's file, copied: its access is only lent until the app stops. */
    fun copy(uri: Uri): Map<String, Any>? {
        val mimeType = context.contentResolver.getType(uri) ?: return null
        val extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType) ?: "bin"
        val file = newFile(extension)
        val input = context.contentResolver.openInputStream(uri) ?: return null

        input.use { source -> file.outputStream().use { source.copyTo(it) } }

        return describe(file, mimeType)
    }

    fun describe(file: File, mimeType: String): Map<String, Any> =
        if (mimeType.startsWith("video/")) describeVideo(file, mimeType) else describeImage(file, mimeType)

    /** Its size as shown: EXIF orientations that turn it a quarter swap width and height. */
    private fun describeImage(file: File, mimeType: String): Map<String, Any> {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }

        BitmapFactory.decodeFile(file.path, bounds)

        val orientation = ExifInterface(file.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        val isTurned = orientation in QUARTER_TURNS

        return description(
            file,
            "image",
            if (isTurned) bounds.outHeight else bounds.outWidth,
            if (isTurned) bounds.outWidth else bounds.outHeight,
            mimeType,
        )
    }

    private fun describeVideo(file: File, mimeType: String): Map<String, Any> {
        val retriever = MediaMetadataRetriever()

        try {
            retriever.setDataSource(file.path)

            val number = { key: Int -> retriever.extractMetadata(key)?.toIntOrNull() ?: 0 }
            val width = number(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)
            val height = number(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)
            val isTurned = number(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION) % 180 != 0
            val milliseconds = number(MediaMetadataRetriever.METADATA_KEY_DURATION)

            return description(file, "video", if (isTurned) height else width, if (isTurned) width else height, mimeType) +
                ("duration" to milliseconds / 1000.0)
        } finally {
            retriever.release()
        }
    }

    private fun description(file: File, type: String, width: Int, height: Int, mimeType: String): Map<String, Any> = mapOf(
        "uri" to Uri.fromFile(file).toString(),
        "type" to type,
        "width" to width,
        "height" to height,
        "mimeType" to mimeType,
        "fileSize" to file.length(),
    )

    private companion object {
        val QUARTER_TURNS = setOf(
            ExifInterface.ORIENTATION_ROTATE_90,
            ExifInterface.ORIENTATION_ROTATE_270,
            ExifInterface.ORIENTATION_TRANSPOSE,
            ExifInterface.ORIENTATION_TRANSVERSE,
        )
    }
}
