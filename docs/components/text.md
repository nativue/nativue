# Text

Shows text. All text must be inside a `<Text>`: text directly in a `<View>` isn't shown.

```vue
<Text :style="{ fontSize: 17, fontWeight: '600', color: '#0b1220' }">
  Hello, {{ name }}
</Text>
```

Text wraps onto as many lines as it needs. Text styles (`color`, `fontSize`, `fontWeight`,
`textAlign`) go on the `<Text>` itself: native views don't inherit them from their parents.

A `<Text>` holds plain text: a `<Text>` inside another one isn't shown, so for differently styled
parts use separate `<Text>`s in a row.

## Props

| Prop    | Type    | Description                                                                       |
| ------- | ------- | --------------------------------------------------------------------------------- |
| `style` | `Style` | text styles: `color`, `fontSize`, `fontWeight`, `textAlign`, and any layout style |

Without a `color`, text follows the system's light or dark appearance.
