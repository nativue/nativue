# @nativue/image-picker

Pick photos and videos, or take them with the camera, in [nativue](https://github.com/nativue/nativue) apps: the
system's photo picker (PHPicker on iOS, the photo picker on Android) and the camera.

```sh
npm install @nativue/image-picker
```

Then rebuild the app (`npm run ios`, `npm run android`): its native code is linked when the app is
built.

```ts
import { ImagePicker } from '@nativue/image-picker'

const [photo] = await ImagePicker.pick() // [] when the user cancels
const photos = await ImagePicker.pick({ limit: 5, mediaTypes: 'all' })
const photo = await ImagePicker.openCamera() // null when the user cancels
const video = await ImagePicker.openCamera({ mediaTypes: 'videos', videoMaxDuration: 60 })
```

```vue
<Image
  v-if="photo"
  :source="photo.uri"
  :style="{ width: 200, aspectRatio: photo.width / photo.height }"
/>
```

## What comes back

| Field      |                                                                                     |
| ---------- | ----------------------------------------------------------------------------------- |
| `uri`      | a `file://` url in the app's cache, which the system may empty: copy what must stay |
| `type`     | `'image'` or `'video'`                                                              |
| `width`    | in pixels, as shown: turned as its orientation says                                 |
| `height`   |                                                                                     |
| `mimeType` | e.g. `'image/jpeg'`                                                                 |
| `fileSize` | in bytes                                                                            |
| `duration` | videos, in seconds                                                                  |

The files are copies: the system lends what's picked only for a while.

## pick(options)

- `limit`: how many can be chosen, 1 (the default), more, or 0 for as many as the system allows.
  Android's photo picker allows a limited number (`MediaStore.getPickImagesMaxLimit()`).
- `mediaTypes`: `'images'` (the default), `'videos'` or `'all'`.

The photo picker needs no permission: the app sees only what the user chooses. iOS gives JPEG and
H.264 rather than HEIC and HEVC, which every platform reads. Android uses the documents screen where
the photo picker isn't available.

## openCamera(options)

The camera, for one photo (JPEG) or one video (MP4 on Android, QuickTime on iOS).

- `mediaTypes`: `'images'` (the default), `'videos'` or `'all'`. On iOS, `'all'` lets the user switch
  between photo and video in the camera; Android's camera app does one or the other, so `'all'`
  takes a photo there.
- `videoMaxDuration`: the longest a video can be, in whole seconds; 0 (the default) for no limit.
- `videoQuality`: `'high'` (the default) or `'low'`, smaller to send. Android passes it to the camera
  app, which may not follow it.

It asks for the camera permission when it needs to (and, for videos on iOS, the microphone's), and
rejects with `ERR_PERMISSION_DENIED` when the camera's is refused, `ERR_UNAVAILABLE` without a
camera that takes them (an iOS simulator's takes no videos).

iOS shows a text when it asks for the camera and the microphone: say what they're for, in
`nativue.config.ts` (Apple's review reads them):

```ts
import imagePicker from '@nativue/image-picker/plugin'

export default defineConfig({
  plugins: [
    imagePicker({
      cameraPermission: 'Take photos of your receipts',
      microphonePermission: 'Record the sound of your videos',
    }),
  ],
})
```

To ask for it ahead, with your own explanation first:

```ts
const { permission, request } = usePermission(
  ImagePicker.getCameraPermission,
  ImagePicker.requestCameraPermission,
)
```

## Permissions

| Permission                                   | Platform | When                                                                                                                          |
| -------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `NSCameraUsageDescription` (the prompt text) | iOS      | always: `cameraPermission`, or a default                                                                                      |
| camera (asked at run time)                   | iOS      | the first `openCamera`                                                                                                        |
| `NSMicrophoneUsageDescription`               | iOS      | always: `microphonePermission`, or a default                                                                                  |
| microphone (asked at run time)               | iOS      | the first `openCamera` that can record a video                                                                                |
| `CAMERA`                                     | Android  | never added: the camera app needs none. If the app declares it for something else, it's asked first, as Android requires then |

No permission is needed to pick photos on either platform.

## When Android closes the app

Android may close the app while the camera or the picker is open, to free memory. What was taken or
chosen then comes back after the app starts again, and `openCamera` or `pick` never resolves. Ask for
it when the app starts:

```ts
const pending = await ImagePicker.getPendingResult() // null when there's none, always on iOS
```
