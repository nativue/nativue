# Components

The components are global in every template: no import needed. Each one is a real native view.

| Component                                           | What it is                                            |
| --------------------------------------------------- | ----------------------------------------------------- |
| [`View`](view.md)                                   | the building block: a container laid out with flexbox |
| [`Text`](text.md)                                   | text                                                  |
| [`Image`](image.md)                                 | a bundled or remote image                             |
| [`Pressable`](pressable.md)                         | anything tappable, with a pressed state               |
| [`Button`](button.md)                               | the platform's text button                            |
| [`TextInput`](text-input.md)                        | a single-line text field                              |
| [`Switch`](switch.md)                               | an on/off toggle                                      |
| [`ScrollView`](scroll-view.md)                      | scrolling content, pull to refresh                    |
| [`FlatList`](flat-list.md)                          | long lists, rendering only the rows on screen         |
| [`Swipeable`](swipeable.md)                         | a row that slides to reveal actions                   |
| [`Modal`](modal.md)                                 | content over the screen: full screen or a sheet       |
| [`ActivityIndicator`](activity-indicator.md)        | a spinner                                             |
| [`SafeAreaView`](safe-area-view.md)                 | keeps content clear of the notch and system bars      |
| [`KeyboardAvoidingView`](keyboard-avoiding-view.md) | moves content above the keyboard                      |
| [`Svg`](svg.md)                                     | low level vector drawing, used by icons               |

Navigation components (`Stack`, `Tabs`, `Link`) are in [Navigation](../navigation.md), and icons in
[`@nativue/icons`](../../packages/icons/README.md).

## What every component takes

- **`style`**: a style object, see [Styling](../styling.md). `:style` also takes an array, like on the
  web: `:style="[styles.card, selected && styles.selected]"`.
- **`class`**: Tailwind classes, with [`@nativue/tailwind`](../../packages/tailwind/README.md).

## Props and events

Write props and events in kebab-case in templates, as in any Vue app: `keyboard-type="email-address"`,
`@change-text="search"`. The tables in these pages use the template names.

Event handlers receive the event's payload, when it has one: `@scroll="({ y }) => …"`.
