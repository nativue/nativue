# Button

The platform's own text button: a system button on iOS, tinted text on Android.

```vue
<Button title="Sign in" @press="signIn" />
```

For a button with your own look, use [`Pressable`](pressable.md).

## Props

| Prop       | Type      | Description                 |
| ---------- | --------- | --------------------------- |
| `title`    | `string`  | the button's text           |
| `disabled` | `boolean` | dims it and ignores touches |
| `style`    | `Style`   | layout only                 |

## Events

| Event    | Fires    |
| -------- | -------- |
| `@press` | on a tap |
