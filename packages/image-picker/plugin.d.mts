import type { NativuePlugin } from '@nativue/core/config'

export interface ImagePickerOptions {
  /** iOS: what the camera permission prompt says the photos and videos are for. */
  cameraPermission?: string
  /** iOS: what the microphone permission prompt, asked before recording a video, says. */
  microphonePermission?: string
}

export default function imagePicker(options?: ImagePickerOptions): NativuePlugin
