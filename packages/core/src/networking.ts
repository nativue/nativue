// The browser's networking classes on globalThis. Its own module, imported by fetch.ts before
// whatwg-fetch: that one checks for Blob, FileReader and FormData as it loads.
import { Blob, File, FileReader } from './blob'
import { AbortController, AbortSignal, Event, EventTarget, ProgressEvent } from './events'
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
})
