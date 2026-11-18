# SafeAreaView

Keeps its content clear of the status bar, the notch, the home indicator and the navigation bar:
it pads itself by those areas, and updates when they change (rotation, a call bar).

```vue
<SafeAreaView :style="{ flex: 1, backgroundColor: '#ffffff' }">
  <Text>Never under the notch.</Text>
</SafeAreaView>
```

Its background still fills the whole area, under the bars. Padding in its style is replaced by the
safe area's: put a `View` with padding inside it.

Screens inside a `Stack` or `Tabs` already start below the header and above the tab bar. For
scrolling content, `content-inset-adjustment-behavior="automatic"` on a
[`ScrollView`](scroll-view.md) lets content scroll under the bars while keeping its edges reachable.

## Props

| Prop    | Type    | Description |
| ------- | ------- | ----------- |
| `style` | `Style` |             |
