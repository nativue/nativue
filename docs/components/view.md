# View

The building block of every screen: a container that lays out its children with flexbox. It's a
`UIView` on iOS and an Android `ViewGroup`.

```vue
<View :style="{ flexDirection: 'row', gap: 12, padding: 16 }">
  <View :style="{ width: 48, height: 48, borderRadius: 24, backgroundColor: 'tomato' }" />
  <Text>Ada Lovelace</Text>
</View>
```

Like on the web, but children stack in a column by default (`flexDirection: 'column'`). See
[Styling](../styling.md) for every style property.

## Props

| Prop    | Type    | Description                  |
| ------- | ------- | ---------------------------- |
| `style` | `Style` | see [Styling](../styling.md) |

Like every component, it takes `role` and `aria-*`: see [Accessibility](../accessibility.md).

## Events

| Event     | Payload       | Fires                            |
| --------- | ------------- | -------------------------------- |
| `@pan`    | `PanEvent`    | while a finger drags on the view |
| `@pinch`  | `PinchEvent`  | while two fingers pinch          |
| `@rotate` | `RotateEvent` | while two fingers rotate         |

Gestures run natively and can move the view without JavaScript on every frame: see
[Animations and gestures](../animations.md#gestures).
