import type { NativuePlugin } from '@nativue/core/config'

export interface ImagePickerOptions {
  /** iOS: what the camera permission prompt says the photos are for. */
  cameraPermission?: string
}

export default function imagePicker(options?: ImagePickerOptions): NativuePlugin
