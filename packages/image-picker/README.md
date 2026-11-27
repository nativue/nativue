# @nativue/image-picker

Pick photos and videos, or take a photo, in [nativue](https://github.com/nativue/nativue) apps: the
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
const taken = await ImagePicker.takePhoto() // null when the user cancels
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

## takePhoto()

The camera, for one photo, saved as JPEG. It asks for the camera permission when it needs to, and
rejects with `ERR_PERMISSION_DENIED` when it's refused, `ERR_UNAVAILABLE` without a camera (a
simulator).

iOS shows a text when it asks for the camera: say what the photos are for, in `nativue.config.ts`
(Apple's review reads it):

```ts
import imagePicker from '@nativue/image-picker/plugin'

export default defineConfig({
  plugins: [imagePicker({ cameraPermission: 'Take photos of your receipts' })],
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
| camera (asked at run time)                   | iOS      | the first `takePhoto`                                                                                                         |
| `CAMERA`                                     | Android  | never added: the camera app needs none. If the app declares it for something else, it's asked first, as Android requires then |

No permission is needed to pick photos on either platform.

## When Android closes the app

Android may close the app while the camera or the picker is open, to free memory. What was taken or
chosen then comes back after the app starts again, and `takePhoto` or `pick` never resolves. Ask for
it when the app starts:

```ts
const pending = await ImagePicker.getPendingResult() // null when there's none, always on iOS
```
