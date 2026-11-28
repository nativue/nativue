import { requireNativeFunction } from '@nativue/core'

export interface ShareContent {
  text?: string
  url?: string
  /** file:// URIs, one or more: photos, videos, PDFs... from Paths, image-picker or file-system. */
  files?: string[]
  /** The subject, where there's one: an email's. */
  subject?: string
  /** Android: the chooser's title. */
  dialogTitle?: string
  /** Android: the files' MIME type, when their extensions don't say it ('image/jpeg'). */
  mimeType?: string
}

export interface ShareResult {
  /**
   * iOS: the user shared it. Android: the user chose an app; whether they sent it there, Android
   * doesn't say. false when they closed the sheet.
   */
  completed: boolean
  /** The chosen app or activity: com.apple.UIKit.activity.Mail, com.whatsapp... null when none. */
  app: string | null
}

type NativeContent = Required<Omit<ShareContent, 'files'>> & { files: string[] }

const nativeShare =
  requireNativeFunction<(content: NativeContent) => Promise<ShareResult>>('share.share')

export const Share = {
  /** The system's share sheet, with what's given: at least one of text, url and files. */
  async share(content: ShareContent): Promise<ShareResult> {
    const {
      text = '',
      url = '',
      files = [],
      subject = '',
      dialogTitle = '',
      mimeType = '',
    } = content

    if (!text && !url && files.length === 0) {
      throw new TypeError('Share.share: give it text, a url or files')
    }
    for (const file of files) {
      if (typeof file !== 'string' || !file.startsWith('file://')) {
        throw new TypeError(`Share.share: files are file:// URIs, not ${file}`)
      }
    }

    return nativeShare({ text, url, files, subject, dialogTitle, mimeType })
  },
}
