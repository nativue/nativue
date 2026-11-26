import { requireNativeFunction } from '@nativue/core'

const nativeCopy = requireNativeFunction<(text: string) => Promise<boolean>>('clipboard.copy')

export interface CopyResult {
  /**
   * Whether the text is on the clipboard. False when the system refused it, e.g. on Android past
   * its ~1MB limit. iOS and Android.
   */
  copied: boolean

  /**
   * Whether the system showed its own "copied" confirmation, so the app shouldn't show one too.
   * True only on Android 13+; always false on iOS and older Android.
   */
  systemConfirmed: boolean
}

export const Clipboard = {
  /**
   * Puts `text` on the clipboard. iOS and Android.
   *
   * @example
   * const { copied, systemConfirmed } = await Clipboard.copy(link)
   * if (copied && !systemConfirmed) showToast('Copied')
   */
  async copy(text: string): Promise<CopyResult> {
    if (typeof text !== 'string') throw new TypeError('Clipboard.copy takes a string')

    try {
      return { copied: true, systemConfirmed: await nativeCopy(text) }
    } catch (error) {
      console.warn('Clipboard.copy failed:', error)

      return { copied: false, systemConfirmed: false }
    }
  },
}
