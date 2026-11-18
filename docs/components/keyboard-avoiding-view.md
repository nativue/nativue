# KeyboardAvoidingView

Moves its content above the keyboard: when the keyboard opens, it pads its bottom by as much as the
keyboard covers it, following the keyboard's own animation.

```vue
<KeyboardAvoidingView :style="{ flex: 1 }">
  <FlatList :data="messages" :item-height="56" :style="{ flex: 1 }">
    <template #item="{ item }"><MessageRow :message="item" /></template>
  </FlatList>
  <MessageComposer />
</KeyboardAvoidingView>
```

Here the list shrinks and the message bar stays right above the keyboard.

## When to use it

- **`KeyboardAvoidingView`:** screens that don't scroll, where something at the bottom must stay
  visible: a chat's message bar, a login form with its button at the bottom, a "Continue" button.
- **A `ScrollView` with
  [`automatically-adjust-keyboard-insets`](scroll-view.md#the-keyboard):** screens that scroll, like
  forms and settings: it scrolls the focused field above the keyboard.

Don't use both for the same content: the keyboard's height would count twice.

## Props

| Prop    | Type    | Description                         |
| ------- | ------- | ----------------------------------- |
| `style` | `Style` | usually `flex: 1`, so it can shrink |
