// The browser's networking classes on globalThis. Its own module, imported by fetch.ts before
// whatwg-fetch: that one checks for Blob, FileReader, FormData and URLSearchParams as it loads.
import { Blob, File, FileReader } from './blob'
import { AbortController, AbortSignal, Event, EventTarget, ProgressEvent } from './events'
import { URL, URLSearchParams } from './url'
import { FormData, XMLHttpRequest } from './xhr'

Object.assign(globalThis, {
  XMLHttpRequest,
  FormData,
  Blob,
  File,
  FileReader,
  AbortController,
  AbortSignal,
  Event,
  EventTarget,
  ProgressEvent,
  URL,
  URLSearchParams,
})
