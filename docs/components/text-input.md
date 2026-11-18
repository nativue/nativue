# TextInput

A single-line text field. Bind it with `v-model`:

```vue
<script setup lang="ts">
import { ref } from 'vue'

const email = ref('')
</script>

<template>
  <TextInput
    v-model="email"
    placeholder="Email"
    keyboard-type="email-address"
    :style="styles.input"
    :focused-style="styles.inputFocused"
    @submit-editing="signIn"
  />
</template>
```

## Props

| Prop                | Type                                                                                 | Description                                              |
| ------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `v-model`           | `string`                                                                             | the text, kept in sync both ways                         |
| `value`             | `string`                                                                             | the text, without `v-model`: pair it with `@change-text` |
| `placeholder`       | `string`                                                                             | shown while empty                                        |
| `keyboard-type`     | `'default' \| 'numeric' \| 'decimal-pad' \| 'email-address' \| 'phone-pad' \| 'url'` | which keyboard opens                                     |
| `secure-text-entry` | `boolean`                                                                            | hides the text, for passwords                            |
| `disabled`          | `boolean`                                                                            | can't be edited                                          |
| `style`             | `Style`                                                                              | box and text styles (`color`, `fontSize`...)             |
| `focused-style`     | `Style`                                                                              | merged over `style` while the field has focus            |

## Events

| Event             | Payload  | Fires                                    |
| ----------------- | -------- | ---------------------------------------- |
| `@change-text`    | `string` | on every change, with the new text       |
| `@submit-editing` | `string` | when the keyboard's return key is tapped |
| `@focus`          |          | when the field gains focus               |
| `@blur`           |          | when the field loses focus               |

## Keyboard

- A tap outside the field, inside a `ScrollView`, closes the keyboard (see
  [`keyboard-should-persist-taps`](scroll-view.md#props)). `Keyboard.dismiss()` closes it from code.
- To keep the field visible above the keyboard, use a `ScrollView` with
  [`automatically-adjust-keyboard-insets`](scroll-view.md#the-keyboard), or a
  [`KeyboardAvoidingView`](keyboard-avoiding-view.md).

With Tailwind, `focus:` and `disabled:` variants style those states:
`class="border-slate-200 focus:border-brand"`.
