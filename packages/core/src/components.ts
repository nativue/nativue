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
const ESTIMATED_ROW_HEIGHT = 50

// Renders only the rows near the visible area; the rest is empty padding of the same height.
// Slots: #item="{ item, index }", plus #header, #footer and #empty. With `item-height`, every row is that
// tall; without it, rows size to their content and are measured as they render. Vertical only.
// Limitation: Items are `any` in the #item slot; make FlatList generic if typed rows are wanted.
// Limitation: An Animated.event `:on-scroll` replaces the window's own scroll handler, and a mapped event
// reaches JS only when a scroll starts and ends; report frames to both natively if that's needed.
export const FlatList = defineComponent({
  name: 'FlatList',
  props: {
    data: { type: Array as PropType<any[]>, required: true },
    itemHeight: Number,
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
    const scrollTop = ref(0)
    const viewportHeight = ref(0)
    const headerHeight = ref(0)
    const measuredHeights = reactive(new Map<string | number, number>())

    const offsets = computed(() => {
      const estimatedHeight = averageOf(measuredHeights.values()) ?? ESTIMATED_ROW_HEIGHT
      const heights = props.data.map(
        (item, index) =>
          props.itemHeight ??
          measuredHeights.get(props.keyExtractor(item, index)) ??
          estimatedHeight,
      )

      return rowOffsets(heights)
    })

    // Numbers, so scrolling within the same rows doesn't re-render.
    const start = computed(() =>
      Math.max(0, rowAt(offsets.value, scrollTop.value) - OFFSCREEN_ROWS_RENDERED),
    )
    const end = computed(() => {
      const lastVisibleRow = rowAt(offsets.value, scrollTop.value + viewportHeight.value)

      return Math.min(props.data.length, lastVisibleRow + 1 + OFFSCREEN_ROWS_RENDERED)
    })

    // Bouncing past either edge reports offsets outside the list: clamp them, or the window (and the
    // layout) would change on every frame of the bounce.
    function handleScroll({ y, height }: ScrollEvent) {
      const maxScrollTop = Math.max(0, offsets.value[props.data.length] - height)

      scrollTop.value = Math.min(Math.max(y - headerHeight.value, 0), maxScrollTop)
      viewportHeight.value = height
    }

    function renderRow(item: unknown, offset: number): VNode {
      const index = start.value + offset
      const key = props.keyExtractor(item, index)
      const sizing = props.itemHeight
        ? { style: { height: props.itemHeight } }
        : { onLayout: ({ height }: LayoutEvent) => measuredHeights.set(key, height) }

      return h('View', { key, ...sizing }, slots.item?.({ item, index }))
    }

    function renderHeader(): VNode | null {
      if (!slots.header) return null

      const onLayout = ({ height }: LayoutEvent) => (headerHeight.value = height)

      return h('View', { onLayout }, slots.header({}))
    }

    return () => {
      const total = offsets.value[props.data.length]
      // overflow: 'scroll' tells Yoga the rows may reach past the window's box: otherwise it caps a row
      // that sizes to its content at the space the paddings leave, which is none.
      const window = {
        paddingTop: offsets.value[start.value],
        paddingBottom: total - offsets.value[end.value],
        overflow: 'scroll' as const,
      }

      // Other attributes (refreshing, @refresh...) fall through to the ScrollView.
      return h('ScrollView', { style: props.style, onScroll: handleScroll }, [
        renderHeader(),
        h('View', { style: window }, props.data.slice(start.value, end.value).map(renderRow)),
        props.data.length === 0 ? slots.empty?.({}) : null,
        slots.footer?.({}),
      ])
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
