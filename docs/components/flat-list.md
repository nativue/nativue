# FlatList

A list for many rows: it renders only the rows near the visible area, so a list of thousands scrolls
as smoothly as a short one.

```vue
<FlatList :data="contacts" :key-extractor="(contact) => contact.id" :style="{ flex: 1 }">
  <template #item="{ item, index }">
    <ContactRow :contact="item" :position="index" />
  </template>
  <template #empty>
    <Text>No contacts yet.</Text>
  </template>
</FlatList>
```

`item` (and the `key-extractor`'s argument) has the type of `data`'s elements: with `contacts` a
`Contact[]`, `item` is a `Contact` in the template, and `npm run typecheck` catches a field it doesn't
have.

Rows size to their content: the list measures each one as it renders, and counts rows it hasn't
rendered yet as the average of those it has. When every row has the same height, pass it as
`item-height`, in points: the list then knows where each row is without measuring, and the scroll bar
is exact from the start.

It scrolls vertically, or sideways with `horizontal`: then rows are measured by their width, and
`item-width` fixes it. The header comes before the rows, on the left, and the footer after them.

```vue
<FlatList :data="photos" horizontal :style="{ height: 120 }">
  <template #item="{ item }">
    <Image :source="{ uri: item.url }" :style="{ width: 160, height: 120, marginRight: 8 }" />
  </template>
</FlatList>
```

## Props

| Prop            | Type                                | Default   | Description                                                     |
| --------------- | ----------------------------------- | --------- | --------------------------------------------------------------- |
| `data`          | `Item[]`                            | required  | the items                                                       |
| `horizontal`    | `boolean`                           | `false`   | scrolls sideways                                                |
| `item-height`   | `number`                            | measured  | every row's height, when they're all the same                   |
| `item-width`    | `number`                            | measured  | every row's width, when horizontal and they're all the same     |
| `key-extractor` | `(item, index) => string \| number` | the index | a stable key per item, so rows keep their state when items move |
| `style`         | `Style`                             |           | the list's own style; give it a bounded size, like `flex: 1`    |

Other attributes go to the underlying [`ScrollView`](scroll-view.md): `refreshing` and `@refresh`
add pull to refresh, `content-inset-adjustment-behavior` keeps it clear of the bars.

## Slots

| Slot      | Receives          | Shows                                     |
| --------- | ----------------- | ----------------------------------------- |
| `#item`   | `{ item, index }` | one row                                   |
| `#header` |                   | above the rows                            |
| `#footer` |                   | below the rows                            |
| `#empty`  |                   | instead of the rows, when `data` is empty |

For rows that slide to reveal actions, put a [`Swipeable`](swipeable.md) in `#item`.
