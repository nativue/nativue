package dev.nativue.imagepicker

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.MediaStore
import androidx.activity.result.contract.ActivityResultContract

internal class CaptureRequest(val output: Uri, val isVideo: Boolean, val videoMaxDuration: Int, val isLowQuality: Boolean)

/** [elsewhere]: where the camera app saved it, when it didn't write into the file it was lent. */
internal class CaptureResult(val isTaken: Boolean, val elsewhere: Uri?)

/** The camera app, for a photo or a video written into the file the app lends it. */
internal class CaptureMedia : ActivityResultContract<CaptureRequest, CaptureResult>() {
    override fun createIntent(context: Context, input: CaptureRequest): Intent {
        if (!input.isVideo) return Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, input.output)

        return Intent(MediaStore.ACTION_VIDEO_CAPTURE)
            .putExtra(MediaStore.EXTRA_OUTPUT, input.output)
            .putExtra(MediaStore.EXTRA_VIDEO_QUALITY, if (input.isLowQuality) 0 else 1)
            .apply { if (input.videoMaxDuration > 0) putExtra(MediaStore.EXTRA_DURATION_LIMIT, input.videoMaxDuration) }
    }

    override fun parseResult(resultCode: Int, intent: Intent?) = CaptureResult(resultCode == Activity.RESULT_OK, intent?.data)
}
