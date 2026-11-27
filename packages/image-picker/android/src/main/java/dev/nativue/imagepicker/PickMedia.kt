package dev.nativue.imagepicker

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContract
import androidx.activity.result.contract.ActivityResultContracts.PickMultipleVisualMedia
import androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia

internal class PickRequest(val limit: Int, val mediaTypes: String)

/**
 * The system's photo picker, for one item or several: the limit is chosen per call, where androidx's
 * contracts fix it when they're registered. Without the photo picker, androidx opens the documents UI.
 */
internal class PickMedia : ActivityResultContract<PickRequest, List<Uri>>() {
    override fun createIntent(context: Context, input: PickRequest): Intent {
        val mediaType = when (input.mediaTypes) {
            "images" -> PickVisualMedia.ImageOnly
            "videos" -> PickVisualMedia.VideoOnly
            else -> PickVisualMedia.ImageAndVideo
        }
        val request = PickVisualMediaRequest.Builder().setMediaType(mediaType).build()

        return when {
            input.limit == 1 -> PickVisualMedia().createIntent(context, request)
            input.limit == 0 -> PickMultipleVisualMedia().createIntent(context, request)
            else -> PickMultipleVisualMedia(minOf(input.limit, systemLimit())).createIntent(context, request)
        }
    }

    /** One item or several, whichever the request was: after a restart, the contract doesn't know. */
    override fun parseResult(resultCode: Int, intent: Intent?): List<Uri> {
        if (resultCode != Activity.RESULT_OK || intent == null) return emptyList()

        val clipUris = intent.clipData?.let { clip -> (0 until clip.itemCount).map { clip.getItemAt(it).uri } }.orEmpty()

        return (listOfNotNull(intent.data) + clipUris).distinct()
    }

    /** The photo picker takes at most this many (Android 13+); asking for more throws. */
    private fun systemLimit(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) MediaStore.getPickImagesMaxLimit() else Int.MAX_VALUE
}
