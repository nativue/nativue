import { addNativeListener, requireNativeFunction } from '@nativue/core'

/** file:// URIs of the app's folders, ending in '/': `Paths.document + 'notes.txt'`. */
export interface AppPaths {
  /** Kept until the app is uninstalled, and backed up. */
  document: string
  /** The system may empty it when space runs low: for what can be fetched again. */
  cache: string
}

export interface FileInfo {
  exists: boolean
  isDirectory: boolean
  /** In bytes; 0 for a directory or what doesn't exist. */
  size: number
  /** Milliseconds since 1970, as Date takes; 0 for what doesn't exist. */
  modificationTime: number
}

export interface WriteOptions {
  /** Add to the end of the file instead of replacing it. */
  append?: boolean
}

export interface TransferProgress {
  bytes: number
  /** null when the server didn't say how many. */
  totalBytes: number | null
}

export interface DownloadOptions {
  headers?: Record<string, string>
  onProgress?: (progress: TransferProgress) => void
}

export interface DownloadResult {
  /** Where it was saved: the `to` it was given. */
  uri: string
  /** As fetch's: a 404 still saves its body and resolves, so check it. */
  status: number
  headers: Record<string, string>
}

export interface UploadOptions {
  /** 'POST' (the default), 'PUT' or 'PATCH'. */
  method?: 'POST' | 'PUT' | 'PATCH'
  headers?: Record<string, string>
  /** Sent as a form (multipart/form-data) instead of the file's bytes alone. */
  multipart?: {
    /** The form field the file goes in: 'file' by default. */
    field?: string
    /** The file name the server sees: the file's own by default. */
    fileName?: string
    mimeType?: string
    /** Other form fields, sent before the file. */
    fields?: Record<string, string>
  }
  onProgress?: (progress: TransferProgress) => void
}

export interface UploadResult {
  status: number
  headers: Record<string, string>
  /** The response's body, as text. */
  body: string
}

/** A download or upload: a promise that also cancels, rejecting with ERR_CANCELED. */
export type Transfer<Result> = Promise<Result> & { cancel(): void }

type NativeProgress = { taskId: number; bytes: number; totalBytes: number }

const nativePaths = requireNativeFunction<() => AppPaths>('fileSystem.paths')
const nativeReadText =
  requireNativeFunction<(uri: string) => Promise<string>>('fileSystem.readText')
const nativeReadBase64 =
  requireNativeFunction<(uri: string) => Promise<string>>('fileSystem.readBase64')
const nativeWriteText =
  requireNativeFunction<(uri: string, text: string, append: boolean) => Promise<void>>(
    'fileSystem.writeText',
  )
const nativeWriteBase64 =
  requireNativeFunction<(uri: string, base64: string, append: boolean) => Promise<void>>(
    'fileSystem.writeBase64',
  )
const nativeGetInfo =
  requireNativeFunction<(uri: string) => Promise<FileInfo>>('fileSystem.getInfo')
const nativeDelete = requireNativeFunction<(uri: string) => Promise<void>>('fileSystem.delete')
const nativeMakeDirectory = requireNativeFunction<(uri: string) => Promise<void>>(
  'fileSystem.makeDirectory',
)
const nativeList = requireNativeFunction<(uri: string) => Promise<string[]>>('fileSystem.list')
const nativeCopy =
  requireNativeFunction<(from: string, to: string) => Promise<void>>('fileSystem.copy')
const nativeMove =
  requireNativeFunction<(from: string, to: string) => Promise<void>>('fileSystem.move')
const nativeDownload =
  requireNativeFunction<
    (
      taskId: number,
      url: string,
      to: string,
      headers: Record<string, string>,
    ) => Promise<DownloadResult>
  >('fileSystem.download')
const nativeUpload =
  requireNativeFunction<
    (
      taskId: number,
      url: string,
      from: string,
      method: string,
      headers: Record<string, string>,
      multipart: Required<NonNullable<UploadOptions['multipart']>> | null,
    ) => Promise<UploadResult>
  >('fileSystem.upload')
const nativeCancel = requireNativeFunction<(taskId: number) => void>('fileSystem.cancel')

let nextTaskId = 1

export const Paths: AppPaths = nativePaths()

// async, so a URI that isn't file:// rejects as native failures do.
export const FileSystem = {
  readText: async (uri: string) => nativeReadText(fileURI(uri)),
  readBase64: async (uri: string) => nativeReadBase64(fileURI(uri)),

  writeText: async (uri: string, text: string, { append = false }: WriteOptions = {}) =>
    nativeWriteText(fileURI(uri), text, append),

  writeBase64: async (uri: string, base64: string, { append = false }: WriteOptions = {}) =>
    nativeWriteBase64(fileURI(uri), base64, append),

  /** Never rejects for what doesn't exist: exists is false. */
  getInfo: async (uri: string) => nativeGetInfo(fileURI(uri)),

  /** A directory goes with what's inside; what doesn't exist is already deleted. */
  delete: async (uri: string) => nativeDelete(fileURI(uri)),

  /** With the directories above it; one that exists is left as it is. */
  makeDirectory: async (uri: string) => nativeMakeDirectory(fileURI(uri)),

  /** The names in a directory. */
  list: async (uri: string) => nativeList(fileURI(uri)),

  /** Replaces what's at `to`. */
  copy: async (from: string, to: string) => nativeCopy(fileURI(from), fileURI(to)),

  /** Replaces what's at `to`. */
  move: async (from: string, to: string) => nativeMove(fileURI(from), fileURI(to)),

  /** Saves url's body at `to`, replacing what's there, once it has all arrived. */
  download(url: string, to: string, { headers = {}, onProgress }: DownloadOptions = {}) {
    return transfer(onProgress, (taskId) =>
      nativeDownload(taskId, webURL(url), fileURI(to), headers),
    )
  },

  upload(url: string, from: string, options: UploadOptions = {}) {
    const { method = 'POST', headers = {}, multipart, onProgress } = options

    return transfer(onProgress, (taskId) => {
      const source = fileURI(from)
      const form = multipart && {
        field: multipart.field ?? 'file',
        fileName: multipart.fileName ?? fileName(source),
        mimeType: multipart.mimeType ?? 'application/octet-stream',
        fields: multipart.fields ?? {},
      }

      return nativeUpload(taskId, webURL(url), source, method, headers, form ?? null)
    })
  },
}

/** start runs at once: its errors reject the transfer, which can be canceled right after. */
function transfer<Result>(
  onProgress: ((progress: TransferProgress) => void) | undefined,
  start: (taskId: number) => Promise<Result>,
): Transfer<Result> {
  const taskId = nextTaskId++
  const subscription =
    onProgress &&
    addNativeListener<NativeProgress>('fileSystem.progress', (progress) => {
      if (progress.taskId !== taskId) return

      onProgress({
        bytes: progress.bytes,
        totalBytes: progress.totalBytes < 0 ? null : progress.totalBytes,
      })
    })
  const promise = startSafely(() => start(taskId)).finally(() => subscription?.remove())

  return Object.assign(promise, { cancel: () => nativeCancel(taskId) })
}

function startSafely<Result>(start: () => Promise<Result>) {
  try {
    return start()
  } catch (error) {
    return Promise.reject(error)
  }
}

function fileName(uri: string) {
  const name = uri.split('/').pop() || 'file'

  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

function fileURI(uri: string) {
  if (typeof uri !== 'string' || !uri.startsWith('file://')) {
    throw new TypeError(`@nativue/file-system: expected a file:// URI, as Paths gives, not ${uri}`)
  }

  return uri
}

function webURL(url: string) {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
    throw new TypeError(`@nativue/file-system: expected an http(s):// URL, not ${url}`)
  }

  return url
}
