# nativue docs

New to nativue? Start with [Getting started](getting-started.md).

## Guides

- [Getting started](getting-started.md): requirements, create an app, run it on a simulator,
  emulator or phone, project structure, release builds
- [Styling](styling.md): style objects, flexbox, colors, dark mode, platform differences, pressed and
  focused states
- [Navigation](navigation.md): file-based routes, layouts, stacks, tabs, modals, header buttons,
  deep links
- [Animations and gestures](animations.md): `Animated`, pan, pinch and rotate, `LayoutAnimation`
- [Accessibility](accessibility.md): VoiceOver and TalkBack, `role` and `aria-*`, `AccessibilityInfo`
- [APIs](apis.md): `AsyncStorage`, `fetch`, `Platform`, `Appearance`, `Keyboard`, `Dimensions`,
  `useWindowDimensions`, timers
- [Packages](packages.md): icons, Tailwind, haptics, SQLite, and writing a package with native code

## Components

| Component                                                      | What it is                                            |
| -------------------------------------------------------------- | ----------------------------------------------------- |
| [`View`](components/view.md)                                   | the building block: a container laid out with flexbox |
| [`Text`](components/text.md)                                   | text                                                  |
| [`Image`](components/image.md)                                 | a bundled or remote image                             |
| [`ImageBackground`](components/image-background.md)            | an image behind other content                         |
| [`Pressable`](components/pressable.md)                         | anything tappable, with a pressed state               |
| [`Button`](components/button.md)                               | the platform's text button                            |
| [`TextInput`](components/text-input.md)                        | a single-line text field                              |
| [`Switch`](components/switch.md)                               | an on/off toggle                                      |
| [`ScrollView`](components/scroll-view.md)                      | scrolling content, pull to refresh                    |
| [`FlatList`](components/flat-list.md)                          | long lists, rendering only the rows on screen         |
| [`Swipeable`](components/swipeable.md)                         | a row that slides to reveal actions                   |
| [`Modal`](components/modal.md)                                 | content over the screen: full screen or a sheet       |
| [`ActivityIndicator`](components/activity-indicator.md)        | a spinner                                             |
| [`SafeAreaView`](components/safe-area-view.md)                 | keeps content clear of the notch and system bars      |
| [`KeyboardAvoidingView`](components/keyboard-avoiding-view.md) | moves content above the keyboard                      |
| [`Svg`](components/svg.md)                                     | low level vector drawing, used by icons               |

Navigation components (`Stack`, `Tabs`, `Link`) are in [Navigation](navigation.md).

## Working on nativue itself

[Developing nativue](development.md): run the demo app, the repository's layout, tests and
releases.
