# Pressable

Makes anything tappable: wrap a card, a row or a custom button in it. It reports presses and knows
when it's pressed, so it can change its look.

```vue
<Pressable
  :style="styles.button"
  :pressed-style="styles.buttonPressed"
  @press="save"
  @long-press="showOptions"
>
  <Text :style="styles.label">Save</Text>
</Pressable>
```

```ts
const styles = StyleSheet.create({
  button: { padding: 16, borderRadius: 12, backgroundColor: '#0e9f84', alignItems: 'center' },
  buttonPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  label: { color: '#ffffff', fontSize: 17, fontWeight: '600' },
})
```

The pressed look stays on for at least 130 ms, so even a quick tap shows it.

## Props

| Prop            | Type      | Description                       |
| --------------- | --------- | --------------------------------- |
| `style`         | `Style`   |                                   |
| `pressed-style` | `Style`   | merged over `style` while pressed |
| `disabled`      | `boolean` | ignores touches                   |

## Events

| Event         | Fires                                                              |
| ------------- | ------------------------------------------------------------------ |
| `@press`      | on a tap: the finger lifted inside                                 |
| `@long-press` | after holding it down; the release that follows is not a `@press`  |
| `@press-in`   | when a finger touches it                                           |
| `@press-out`  | when the finger lifts, leaves it, or a scroll takes over the touch |

## Slot

The default slot receives `{ pressed }`, to change the content while pressed:

```vue
<Pressable v-slot="{ pressed }" @press="like">
  <HeartIcon :color="pressed ? 'red' : 'gray'" />
</Pressable>
```

## Disabled

A disabled `Pressable` ignores touches; style it yourself, since you know when it's disabled:

```vue
<Pressable :disabled="saving" :style="[styles.button, saving && styles.buttonDisabled]" @press="save">
```

With Tailwind, use the `active:` and `disabled:` variants:
`class="bg-brand active:bg-ink disabled:bg-slate-300"`.

Inside a `ScrollView`, dragging that starts on a `Pressable` scrolls, and the press is cancelled.
