# Accessibility

nativue's views are the platform's own, so VoiceOver (iOS) and TalkBack (Android) read them like any
native app: text, buttons, switches, text fields, headers and tab bars work without extra code. Text
also follows the system's text size (see [`Text`](components/text.md)).

What a screen reader can't guess, you tell it with the attributes you know from the web.

## Attributes

They work on every component.

| Attribute          | Values                                                                                   | What it does                                                   |
| ------------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `role`             | `'button'`, `'link'`, `'heading'`, `'img'`, `'text'`, `'switch'`, `'checkbox'`, `'none'` | what the view is; read after its label                         |
| `aria-label`       | a string                                                                                 | what the screen reader says, instead of the text inside        |
| `aria-description` | a string                                                                                 | said after the label: what happens when it's activated         |
| `aria-hidden`      | a boolean                                                                                | hides it, and everything inside it, from the screen reader     |
| `aria-disabled`    | a boolean                                                                                | read as dimmed or disabled                                     |
| `aria-selected`    | a boolean                                                                                | read as selected, e.g. the current item of a segmented control |
| `aria-checked`     | a boolean                                                                                | with `role="switch"` or `role="checkbox"`: read as on or off   |
| `alt`              | a string                                                                                 | on an [`Image`](components/image.md): what it shows            |

Other `aria-*` attributes aren't supported: they log a warning once.

## One element, read as one

A view with a `role` or an `aria-label` is a single element for the screen reader, like a `<button>`
on the web: without an `aria-label`, it reads the text inside it.

```vue
<Pressable @press="open">
  <Text>Buy milk</Text>
  <Text>Tomorrow</Text>
</Pressable>
<!-- "Buy milk, Tomorrow, button" -->

<View role="text">
  <Text>42</Text>
  <Text>steps</Text>
</View>
<!-- "42, steps" -->
```

`role="none"` does the opposite: the view isn't an element, and what's inside is read on its own.

## Defaults

- [`Pressable`](components/pressable.md) is `role="button"`, and its `disabled` is also
  `aria-disabled`. Set `role` or `aria-label` to change them.
- `Button`, `Switch`, `TextInput` and `Text` already say what they are.
- An [`Image`](components/image.md) without `alt` is skipped, as decorative.
- Icons from `@nativue/icons` are skipped: give the button that holds them an `aria-label`.

```vue
<Pressable aria-label="Delete" @press="remove">
  <TrashIcon />
</Pressable>

<Text role="heading">Settings</Text>

<Image :source="avatar" :alt="`${user.name}'s photo`" />

<Pressable role="switch" :aria-checked="isOn" @press="isOn = !isOn">
  <Text>Wi-Fi</Text>
</Pressable>
```

## AccessibilityInfo

```ts
import { AccessibilityInfo } from 'vue'

AccessibilityInfo.isScreenReaderEnabled() // VoiceOver or TalkBack is on
AccessibilityInfo.isReduceMotionEnabled() // the user asked for less motion: skip decorative animations
AccessibilityInfo.announce('Saved') // the screen reader says it
```

## Checking your app

Turn on VoiceOver (Settings → Accessibility → VoiceOver) or TalkBack (Settings → Accessibility →
TalkBack) and go through each screen: swipe right moves to the next element, double tap activates it.
On iOS, Xcode's Accessibility Inspector also lists what each element says.
