// Components built in JS on top of native primitives.
import {
  computed,
  defineComponent,
  h,
  onBeforeUnmount,
  reactive,
  ref,
  watch,
  type PropType,
  type SlotsType,
  type VNode,
} from '@vue/runtime-core'
import { rowAt, rowOffsets } from './list-window'
import type { LayoutEvent, ScrollEvent, Style } from './types'

type Listener = ((payload: unknown) => void) | undefined

const MINIMUM_PRESSED_TIME = 130 // ms

// Vue's template compiler normalizes `:style`, so it can't be a function of the pressed state: the pressed
// look goes in `pressed-style`, merged over `style` while pressed. The slot also receives { pressed },
// and the class its pressed styles (Tailwind's active:). A disabled one ignores touches.
export const Pressable = defineComponent({
  name: 'Pressable',
  inheritAttrs: false,
  props: {
    style: Object as PropType<Style>,
    pressedStyle: Object as PropType<Style>,
    disabled: Boolean,
  },
  slots: Object as SlotsType<{ default: { pressed: boolean } }>,

  setup(props, { attrs, slots }) {
    const pressed = ref(false)
    let pressedAt = 0
    let releaseTimeout: ReturnType<typeof setTimeout> | undefined

    function release() {
      clearTimeout(releaseTimeout)
      pressed.value = false
    }

    // Disabled mid-press, the native view may never send the pressout.
    watch(
      () => props.disabled,
      (disabled) => {
        if (disabled) release()
      },
    )

    function handlePressIn(payload: unknown) {
      clearTimeout(releaseTimeout)
      pressedAt = Date.now()
      pressed.value = true
      ;(attrs.onPressIn as Listener)?.(payload)
    }

    // A quick tap would show the pressed style for less than a frame: keep it for a moment.
    function handlePressOut(payload: unknown) {
      const remainingTime = MINIMUM_PRESSED_TIME - (Date.now() - pressedAt)

      releaseTimeout = setTimeout(release, Math.max(0, remainingTime))
      ;(attrs.onPressOut as Listener)?.(payload)
    }

    onBeforeUnmount(() => clearTimeout(releaseTimeout))

    return () => {
      const style = pressed.value ? { ...props.style, ...props.pressedStyle } : props.style

      return h(
        'PressableView',
        {
          role: 'button',
          'aria-disabled': props.disabled || undefined,
          ...attrs,
          style,
          pressed: pressed.value,
          disabled: props.disabled || undefined, // unset, nothing to send
          onPressIn: handlePressIn,
          onPressOut: handlePressOut,
        },
        slots.default?.({ pressed: pressed.value }),
      )
    }
  },
})

const OFFSCREEN_ROWS_RENDERED = 10
// What a row not yet measured counts as, until some are: then their average.
const ESTIMATED_ROW_LENGTH = 50

// Renders only the rows near the visible area; the rest is empty padding of the same length.
// Slots: #item="{ item, index }", plus #header, #footer and #empty. Vertical by default, sideways with
// `horizontal`. With `item-height` (or `item-width` when horizontal), every row is that long; without
// it, rows size to their content and are measured as they render.
// Limitation: Rows not rendered yet count as the average measured length, so jumping far (dragging the
// scroll indicator) can shift the rows a few points once they're measured; anchor the scroll position
// to the first visible row if that shows.
// Limitation: Items are `any` in the #item slot; make FlatList generic if typed rows are wanted.
// Limitation: An Animated.event `:on-scroll` replaces the window's own scroll handler, and a mapped event
// reaches JS only when a scroll starts and ends; report frames to both natively if that's needed.
export const FlatList = defineComponent({
  name: 'FlatList',
  props: {
    data: { type: Array as PropType<any[]>, required: true },
    horizontal: Boolean,
    itemHeight: Number,
    itemWidth: Number,
    keyExtractor: {
      type: Function as PropType<(item: any, index: number) => string | number>,
      default: (_item: unknown, index: number) => index,
    },
    style: Object as PropType<Style>,
  },
  slots: Object as SlotsType<{
    item: { item: any; index: number }
    header?: {}
    footer?: {}
    empty?: {}
  }>,

  setup(props, { slots }) {
    const scrollPosition = ref(0)
    const viewportLength = ref(0)
    const headerLength = ref(0)
    const measuredLengths = reactive(new Map<string | number, number>())

    // Along the scroll direction: heights for a vertical list, widths for a horizontal one.
    const fixedLength = computed(() => (props.horizontal ? props.itemWidth : props.itemHeight))
    const lengthOf = ({ width, height }: { width: number; height: number }) =>
      props.horizontal ? width : height

    const offsets = computed(() => {
      const estimatedLength = averageOf(measuredLengths.values()) ?? ESTIMATED_ROW_LENGTH
      const lengths = props.data.map(
        (item, index) =>
          fixedLength.value ??
          measuredLengths.get(props.keyExtractor(item, index)) ??
          estimatedLength,
      )

      return rowOffsets(lengths)
    })

    // Numbers, so scrolling within the same rows doesn't re-render.
    const start = computed(() =>
      Math.max(0, rowAt(offsets.value, scrollPosition.value) - OFFSCREEN_ROWS_RENDERED),
    )
    const end = computed(() => {
      const lastVisibleRow = rowAt(offsets.value, scrollPosition.value + viewportLength.value)

      return Math.min(props.data.length, lastVisibleRow + 1 + OFFSCREEN_ROWS_RENDERED)
    })

    // Bouncing past either edge reports offsets outside the list: clamp them, or the window (and the
    // layout) would change on every frame of the bounce.
    function handleScroll(event: ScrollEvent) {
      const offset = props.horizontal ? event.x : event.y
      const length = lengthOf(event)
      const maxScrollPosition = Math.max(0, offsets.value[props.data.length] - length)

      scrollPosition.value = Math.min(Math.max(offset - headerLength.value, 0), maxScrollPosition)
      viewportLength.value = length
    }

    function renderRow(item: unknown, offset: number): VNode {
      const index = start.value + offset
      const key = props.keyExtractor(item, index)
      const sizing = fixedLength.value
        ? { style: props.horizontal ? { width: fixedLength.value } : { height: fixedLength.value } }
        : { onLayout: (layout: LayoutEvent) => measuredLengths.set(key, lengthOf(layout)) }

      return h('View', { key, ...sizing }, slots.item?.({ item, index }))
    }

    function renderHeader(): VNode | null {
      if (!slots.header) return null

      const onLayout = (layout: LayoutEvent) => (headerLength.value = lengthOf(layout))

      return h('View', { onLayout }, slots.header({}))
    }

    // overflow: 'scroll' tells Yoga the rows may reach past the window's box: otherwise it caps a row
    // that sizes to its content at the space the paddings leave, which is none.
    function windowStyle(): Style {
      const before = offsets.value[start.value]
      const after = offsets.value[props.data.length] - offsets.value[end.value]

      if (props.horizontal) {
        return {
          flexDirection: 'row',
          paddingLeft: before,
          paddingRight: after,
          overflow: 'scroll',
        }
      }

      return { paddingTop: before, paddingBottom: after, overflow: 'scroll' }
    }

    return () => {
      const rows = props.data.slice(start.value, end.value).map(renderRow)

      // Other attributes (refreshing, @refresh...) fall through to the ScrollView.
      return h(
        'ScrollView',
        { style: props.style, horizontal: props.horizontal, onScroll: handleScroll },
        [
          renderHeader(),
          h('View', { style: windowStyle() }, rows),
          props.data.length === 0 ? slots.empty?.({}) : null,
          slots.footer?.({}),
        ],
      )
    }
  },
})

function averageOf(values: Iterable<number>): number | undefined {
  let sum = 0
  let count = 0
  for (const value of values) {
    sum += value
    count++
  }

  return count === 0 ? undefined : sum / count
}

const FILL_STYLE: Style = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }

// An <Image> behind its children: it fills the box, which `style` sizes. Takes the Image's props; other
// attributes (role, aria-*, @layout...) go to the box.
export const ImageBackground = defineComponent({
  name: 'ImageBackground',
  props: {
    source: { type: [String, Object] as PropType<string | { uri: string }>, required: true },
    resizeMode: String as PropType<'cover' | 'contain' | 'stretch' | 'center'>,
    cache: String as PropType<'disk' | 'memory' | 'none'>,
    alt: String,
    style: Object as PropType<Style>,
  },
  slots: Object as SlotsType<{ default?: {} }>,

  setup(props, { slots }) {
    return () => {
      const { style, ...imageProps } = props

      return h('View', { style }, [
        h('Image', { ...imageProps, style: FILL_STYLE }),
        slots.default?.({}),
      ])
    }
  },
})

const SWIPE_ACTIONS_STYLE: Style = { position: 'absolute', top: 0, bottom: 0, flexDirection: 'row' }
const SWIPE_LEFT_ACTIONS_STYLE: Style = { ...SWIPE_ACTIONS_STYLE, left: 0 }
const SWIPE_RIGHT_ACTIONS_STYLE: Style = { ...SWIPE_ACTIONS_STYLE, right: 0 }
const SWIPE_ROW_STYLE: Style = { flex: 1 }

// A row that slides sideways to reveal actions behind it (like Mail); the drag runs natively.
// #left-actions show when dragging right, #right-actions when dragging left.
//   <Swipeable>
//     <template #right-actions><Pressable @press="remove">...</Pressable></template>
//     row content
//   </Swipeable>
export const Swipeable = defineComponent({
  name: 'Swipeable',
  props: { style: Object as PropType<Style> },
  slots: Object as SlotsType<{ default?: {}; 'left-actions'?: {}; 'right-actions'?: {} }>,

  setup(props, { slots }) {
    return () =>
      h('SwipeableView', { style: props.style }, [
        h('View', { style: SWIPE_LEFT_ACTIONS_STYLE }, slots['left-actions']?.({})),
        h('View', { style: SWIPE_RIGHT_ACTIONS_STYLE }, slots['right-actions']?.({})),
        h('View', { style: SWIPE_ROW_STYLE }, slots.default?.({})),
      ])
  },
})
