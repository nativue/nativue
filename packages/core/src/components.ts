// Components built in JS on top of native primitives.
import {
  computed,
  defineComponent,
  h,
  ref,
  watch,
  type PropType,
  type SlotsType,
  type VNode,
} from '@vue/runtime-core'
import type { ScrollEvent, Style } from './types'

type Listener = ((payload: unknown) => void) | undefined

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

    // Disabled mid-press, the native view may never send the pressout.
    watch(
      () => props.disabled,
      (disabled) => {
        if (disabled) pressed.value = false
      },
    )

    function setPressed(value: boolean, listener: Listener) {
      return (payload: unknown) => {
        pressed.value = value
        listener?.(payload)
      }
    }

    return () => {
      const style = pressed.value ? { ...props.style, ...props.pressedStyle } : props.style

      return h(
        'PressableView',
        {
          ...attrs,
          style,
          pressed: pressed.value,
          disabled: props.disabled || undefined, // unset, nothing to send
          onPressIn: setPressed(true, attrs.onPressIn as Listener),
          onPressOut: setPressed(false, attrs.onPressOut as Listener),
        },
        slots.default?.({ pressed: pressed.value }),
      )
    }
  },
})

const OFFSCREEN_ROWS_RENDERED = 10

// Renders only the rows near the visible area; the rest is empty padding of the same height.
// Slots: #item="{ item, index }", plus #header, #footer and #empty.
// ponytail: rows have a fixed `itemHeight`; measure rows natively if
// variable heights are ever needed. Vertical only. The window ignores the header's height, which the
// offscreen rows absorb while the header is shorter than them; measure it if tall headers show gaps.
// ponytail: items are `any` in the #item slot; make FlatList generic if typed rows are wanted.
// ponytail: an Animated.event `:on-scroll` replaces the window's own scroll handler, and a mapped event
// reaches JS only when a scroll starts and ends; report frames to both natively if that's needed.
export const FlatList = defineComponent({
  name: 'FlatList',
  props: {
    data: { type: Array as PropType<any[]>, required: true },
    itemHeight: { type: Number, required: true },
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
    // Whole rows, so scrolling within a row doesn't re-render (refs ignore same-value writes).
    const firstVisibleRow = ref(0)
    const visibleRowCount = ref(0)

    const visibleRange = computed(() => {
      const start = Math.max(0, firstVisibleRow.value - OFFSCREEN_ROWS_RENDERED)
      const end = Math.min(
        props.data.length,
        firstVisibleRow.value + visibleRowCount.value + OFFSCREEN_ROWS_RENDERED,
      )

      return { start, end }
    })

    // Bouncing past either edge reports offsets outside the list: clamp them, or the window (and the
    // layout) would change on every frame of the bounce.
    function handleScroll({ y, height }: ScrollEvent) {
      const maxScrollTop = Math.max(0, props.data.length * props.itemHeight - height)
      const scrollTop = Math.min(Math.max(y, 0), maxScrollTop)

      firstVisibleRow.value = Math.floor(scrollTop / props.itemHeight)
      visibleRowCount.value = Math.ceil(height / props.itemHeight)
    }

    function renderRow(item: unknown, offset: number): VNode {
      const index = visibleRange.value.start + offset

      return h(
        'View',
        { key: props.keyExtractor(item, index), style: { height: props.itemHeight } },
        slots.item?.({ item, index }),
      )
    }

    return () => {
      const { start, end } = visibleRange.value
      const window = {
        paddingTop: start * props.itemHeight,
        paddingBottom: (props.data.length - end) * props.itemHeight,
      }

      // Other attributes (refreshing, @refresh...) fall through to the ScrollView.
      return h('ScrollView', { style: props.style, onScroll: handleScroll }, [
        slots.header?.({}),
        h('View', { style: window }, props.data.slice(start, end).map(renderRow)),
        props.data.length === 0 ? slots.empty?.({}) : null,
        slots.footer?.({}),
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
