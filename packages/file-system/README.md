# @nativue/file-system

Read, write, download and upload files in [nativue](https://github.com/nativue/nativue) apps.

```sh
npm install @nativue/file-system
```

Then rebuild the app (`npm run ios`, `npm run android`): its native code is linked when the app is
built.

```ts
import { FileSystem, Paths } from '@nativue/file-system'

const notes = `${Paths.document}notes.txt`

await FileSystem.writeText(notes, 'First line')
await FileSystem.writeText(notes, '\nSecond line', { append: true })
const text = await FileSystem.readText(notes)
```

Files are named by `file://` URIs: `Paths` gives the app's folders, and other packages hand them over
(a photo from `@nativue/image-picker` is one). `<Image :source="uri" />` shows an image file. As in
any URI, `%` starts an escape: a name with a `%` of its own goes through `encodeURIComponent`.

## Folders

| `Paths`    |                                                                                       |
| ---------- | ------------------------------------------------------------------------------------- |
| `document` | kept until the app is uninstalled, and backed up                                      |
| `cache`    | the system may empty it when space runs low: for what can be downloaded or made again |

Both end in `/`. Writing to a file makes the folders above it.

## Files

| Function                               |                                                                  |
| -------------------------------------- | ---------------------------------------------------------------- |
| `readText(uri)`                        | the file as UTF-8 text                                           |
| `readBase64(uri)`                      | its bytes, in base64                                             |
| `writeText(uri, text, { append })`     | replaces the file, or adds to its end with `append: true`        |
| `writeBase64(uri, base64, { append })` | the same, from base64                                            |
| `getInfo(uri)`                         | `{ exists, isDirectory, size, modificationTime }`; never rejects |
| `delete(uri)`                          | a directory goes with what's inside; what doesn't exist is fine  |
| `makeDirectory(uri)`                   | with the directories above it; one that exists is fine           |
| `list(uri)`                            | the names in a directory, sorted                                 |
| `copy(from, to)` / `move(from, to)`    | replace what's at `to`                                           |

`writeText`, `writeBase64` and `download` write beside the file first, so a failure halfway leaves the
old one whole. `copy` and `move` check the source exists before they replace anything.

## Downloads and uploads

```ts
const download = FileSystem.download(url, `${Paths.cache}report.pdf`, {
  headers: { Authorization: `Bearer ${token}` },
  onProgress: ({ bytes, totalBytes }) => (progress.value = totalBytes ? bytes / totalBytes : 0),
})
const { status, uri } = await download

const { status, body } = await FileSystem.upload('https://api.example.com/photos', photo.uri, {
  multipart: { field: 'photo', mimeType: 'image/jpeg', fields: { caption: 'Beach' } },
})
```

- `download` saves the body once it has all arrived, replacing what's at `to`.
- `upload` sends the file's bytes alone, or as a form with `multipart` (`field`, `fileName`,
  `mimeType`, and other `fields`). `method` is `'POST'` (the default), `'PUT'` or `'PATCH'`.
- As with `fetch`, an HTTP error resolves: check `status`. The response's `headers` have lowercase
  names, and an upload's `body` is its text.
- `onProgress` gets `{ bytes, totalBytes }` about ten times a second; `totalBytes` is `null` when the
  server doesn't say.
- `cancel()` stops it and rejects with `ERR_CANCELED`.

### Large files

Files of any size stream between the disk and the network in small pieces: a 4 GB video never sits
in memory.

**A download continues where it stopped.** What has arrived waits beside `to` (as `.name.partial`),
with the server's name for its file (`ETag`, or else `Last-Modified`). Downloading to the same `to`
again asks only for the rest (`Range`, with `If-Range`), whether it stopped because of a pause, a lost
connection or the app closing:

```ts
download.pause() // keeps what arrived
download.resume() // asks for the rest
download.cancel() // throws away what arrived
```

The whole file is downloaded again when the server's file changed, when it doesn't send ranges, or
when the server named nothing to compare. A partial file in `Paths.cache` can be emptied by the
system like the rest of it: the download then starts over.

**An upload goes in parts**, for services that put a large file together from pieces (S3 multipart
uploads, tus): `offset` and `length` send only that slice of the file. When the connection drops,
only the part that was going is sent again:

```ts
const PART = 8 * 1024 * 1024

for (let offset = 0; offset < size; offset += PART) {
  const { headers } = await FileSystem.upload(partURLs[offset / PART], video.uri, {
    method: 'PUT',
    offset,
    length: PART,
  })

  etags.push(headers.etag)
}
```

Transfers run while the app is open: closing it stops them, and a download picks up from there the
next time.

## Errors

| `code`                 | When                                                                             |
| ---------------------- | -------------------------------------------------------------------------------- |
| `ERR_NOT_FOUND`        | reading, listing, copying or uploading what isn't there                          |
| `ERR_INVALID_ARGUMENT` | not a `file://` URI, text that isn't UTF-8, bad base64, an `offset` past the end |
| `ERR_CANCELED`         | a transfer was canceled                                                          |
| `ERR_UNAVAILABLE`      | anything else: no space, no connection, no permission                            |

## Permissions

None: the app's own folders need none. Android blocks plain `http://` unless the app allows it.
