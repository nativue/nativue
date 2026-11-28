# @nativue/share

The system's share sheet in [nativue](https://github.com/nativue/nativue) apps: text, links,
photos, videos and any other file, to any app that takes them.

```sh
npm install @nativue/share
```

Then rebuild the app (`npm run ios`, `npm run android`): its native code is linked when the app is
built.

```ts
import { Share } from '@nativue/share'

await Share.share({ text: 'Look at this', url: 'https://github.com/nativue/nativue' })
await Share.share({ files: [photo.uri] }) // a photo from @nativue/image-picker
const { completed, app } = await Share.share({
  files: [`${Paths.document}report.pdf`, `${Paths.document}chart.png`],
  subject: 'November report', // an email's subject
})
```

## What to share

| Field         |                                                                               |
| ------------- | ----------------------------------------------------------------------------- |
| `text`        | text                                                                          |
| `url`         | a link; on Android it goes after the text, as Android's share has one text    |
| `files`       | `file://` URIs: photos, videos, PDFs... one or more                           |
| `subject`     | where apps take one, as Mail does                                             |
| `dialogTitle` | Android: the chooser's title                                                  |
| `mimeType`    | Android: the files' type, when their extensions don't say it (`'image/jpeg'`) |

At least one of `text`, `url` and `files`. Files must be in the app's folders: `Paths.document` and
`Paths.cache` from `@nativue/file-system`, where other packages save theirs too. On Android, the app
that receives them reads them through `content://` URIs that only it gets.

## What comes back

| Field       |                                                                                         |
| ----------- | --------------------------------------------------------------------------------------- |
| `completed` | iOS: the user shared it. Android: the user chose an app. `false` when the sheet closed  |
| `app`       | what was chosen, e.g. `com.apple.UIKit.activity.Mail` or `com.whatsapp`; `null` if none |

Android only says which app was chosen: not whether the user sent it once there.

## Errors

| `code`                 | When                                         |
| ---------------------- | -------------------------------------------- |
| `ERR_NOT_FOUND`        | a file isn't there                           |
| `ERR_INVALID_ARGUMENT` | on Android, a file outside the app's folders |
| `ERR_UNAVAILABLE`      | the share sheet is already open              |

## Permissions

None.
