# ScrollView

Scrolling content: vertical by default, horizontal with `horizontal`. It renders all its children;
for long lists, use [`FlatList`](flat-list.md).

```vue
<ScrollView :style="{ flex: 1 }" content-inset-adjustment-behavior="automatic">
  <View :style="{ padding: 16, gap: 16 }">
    <Card v-for="post in posts" :key="post.id" :post="post" />
  </View>
</ScrollView>
```

Give the `ScrollView` a bounded size (`flex: 1`, or a `height`); its content grows as tall as it
needs.

## Props

| Prop                                   | Type                                                     | Default   | Description                                                                                                            |
| -------------------------------------- | -------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `horizontal`                           | `boolean`                                                | `false`   | scrolls sideways                                                                                                       |
| `paging-enabled`                       | `boolean`                                                | `false`   | stops on whole pages (its own width or height), like a carousel                                                        |
| `shows-vertical-scroll-indicator`      | `boolean`                                                | `true`    |                                                                                                                        |
| `shows-horizontal-scroll-indicator`    | `boolean`                                                | `true`    |                                                                                                                        |
| `content-inset-adjustment-behavior`    | `'automatic' \| 'scrollableAxes' \| 'never' \| 'always'` | `'never'` | `'automatic'` keeps the content clear of the navigation bar, status bar and home indicator while it scrolls under them |
| `keyboard-dismiss-mode`                | `'none' \| 'on-drag' \| 'interactive'`                   | `'none'`  | `'on-drag'` closes the keyboard when the user scrolls; `'interactive'` (iOS) lets the drag pull it down                |
| `keyboard-should-persist-taps`         | `'never' \| 'always' \| 'handled'`                       | `'never'` | `'never'`: a tap outside a text field closes the keyboard; `'always'` and `'handled'` keep it open                     |
| `automatically-adjust-keyboard-insets` | `boolean`                                                | `false`   | makes room for the keyboard and scrolls the focused field above it, see [below](#the-keyboard)                         |
| `scroll-event-throttle`                | `number`                                                 | `0`       | at most one `@scroll` per this many milliseconds; the last position always arrives. `0` sends one every frame          |
| `refreshing`                           | `boolean`                                                |           | shows the pull-to-refresh spinner, with `@refresh`                                                                     |
| `style`                                | `Style`                                                  |           |                                                                                                                        |

## Events

| Event      | Payload                   | Fires                                                                                                                                  |
| ---------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `@scroll`  | `{ x, y, width, height }` | on every scroll step (or as `scroll-event-throttle` allows), and when its size changes: the visible area, in the content's coordinates |
| `@refresh` |                           | when the user pulls to refresh                                                                                                         |

## Pull to refresh

Listening to `@refresh` adds the spinner. Set `refreshing` while loading, and back to `false` when
done:

```vue
<ScrollView :refreshing="loading" @refresh="reload">
```

## The keyboard

With `automatically-adjust-keyboard-insets`, the `ScrollView` makes room for the keyboard when it
opens and scrolls just enough for the focused text field to sit above it. Use it for screens that
scroll, like forms and settings.

For screens that don't scroll, where something at the bottom must stay above the keyboard (a chat's
message bar, a "Continue" button), use [`KeyboardAvoidingView`](keyboard-avoiding-view.md). Don't
combine both on the same screen: the keyboard's height would count twice.

## Scroll-driven animations

`@scroll` can drive animated values natively, for collapsing headers and parallax: see
[Animations and gestures](../animations.md#scroll).
