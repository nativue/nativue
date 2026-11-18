# Swipeable

A row that slides sideways to reveal actions behind it, like in a mail app. The drag runs natively,
so the row follows the finger exactly.

```vue
<Swipeable>
  <template #right-actions>
    <Pressable :style="styles.deleteAction" @press="remove(message)">
      <Text :style="styles.actionLabel">Delete</Text>
    </Pressable>
  </template>
  <MessageRow :message="message" />
</Swipeable>
```

Released past half of its actions, or flicked, the row stays open. A tap on the open row or on an
action closes it.

## Props

| Prop    | Type    | Description |
| ------- | ------- | ----------- |
| `style` | `Style` |             |

## Slots

| Slot             | Shows                                |
| ---------------- | ------------------------------------ |
| default          | the row's content                    |
| `#left-actions`  | actions revealed when dragging right |
| `#right-actions` | actions revealed when dragging left  |

Give the actions a width in their style: the row opens as far as they reach.
