// Types of the native components (<View>, <Text>...) so templates get autocomplete and checks.
// Events are listed as on* props: @press is onPress, @change-text is onChangeText.
import type { DefineComponent } from '@vue/runtime-core'
import type { AnimatedEvent } from './animated'
import type { FlatList, ImageBackground, Pressable, Swipeable } from './components'
import type { LayoutEvent, PanEvent, PinchEvent, RotateEvent, ScrollEvent, Style } from './types'

type NativeComponent<Props = {}> = DefineComponent<
  Props & { style?: Style; onLayout?: (event: LayoutEvent) => void } & AccessibilityProps
>
type BooleanAttribute = boolean | 'true' | 'false'
// As on the web: what a screen reader says about the view. See docs/accessibility.md.
export interface AccessibilityProps {
  role?: 'button' | 'link' | 'heading' | 'img' | 'text' | 'switch' | 'checkbox' | 'none'
  /** What the screen reader says. Without one, a view with a role reads the text inside it. */
  'aria-label'?: string
  /** Said after the label: what happens when it's activated. */
  'aria-description'?: string
  /** Hides it, and everything inside it, from the screen reader. */
  'aria-hidden'?: BooleanAttribute
  'aria-disabled'?: BooleanAttribute
  'aria-selected'?: BooleanAttribute
  /** For role="switch" and role="checkbox". */
  'aria-checked'?: BooleanAttribute
}
type EventHandler<Payload> = ((payload: Payload) => void) | AnimatedEvent<Payload>
type SvgLength = number | string
/** Inherited by what's inside, as in SVG: fill, stroke... A color, 'none', 'currentColor' or 'url(#id)'. */
export interface SvgPresentationAttributes {
  id?: string
  fill?: string
  stroke?: string
  strokeWidth?: SvgLength
  strokeLinecap?: 'butt' | 'round' | 'square'
  strokeLinejoin?: 'miter' | 'round' | 'bevel'
  strokeDasharray?: string
  opacity?: number | string
  fillOpacity?: number | string
  strokeOpacity?: number | string
  fillRule?: 'nonzero' | 'evenodd'
  transform?: string
  /** A press on the element (or on a group's), where it's drawn. */
  onPress?: (location: { x: number; y: number }) => void
}
type SvgGradientAttributes = {
  gradientUnits?: 'objectBoundingBox' | 'userSpaceOnUse'
  gradientTransform?: string
}
type SvgComponent<Props = {}> = DefineComponent<SvgPresentationAttributes & Props>
// [tag, attributes], e.g. ['circle', { cx: 12, cy: 12, r: 10 }]: path, circle, ellipse, rect, line,
// polyline and polygon. Stroked with `color`; filled too when `fill` isn't 'none'.
export type SvgElement = [tag: string, attributes: Record<string, string | number>]
// An icon component that carries its drawing, so it can also be a tab bar icon (see @nativue/icons).
export interface SvgIcon {
  svg: { viewBox: [number, number, number, number]; elements: SvgElement[] }
}
type ModelProps<Value> = { modelValue?: Value; 'onUpdate:modelValue'?: (value: Value) => void }

declare module '@vue/runtime-core' {
  export interface GlobalComponents {
    View: NativeComponent<{
      onPan?: EventHandler<PanEvent>
      onPinch?: EventHandler<PinchEvent>
      onRotate?: EventHandler<RotateEvent>
    }>
    Text: NativeComponent
    SafeAreaView: NativeComponent
    KeyboardAvoidingView: NativeComponent
    Button: NativeComponent<{ title: string; disabled?: boolean; onPress?: () => void }>
    ScrollView: NativeComponent<{
      horizontal?: boolean
      pagingEnabled?: boolean
      showsHorizontalScrollIndicator?: boolean
      showsVerticalScrollIndicator?: boolean
      refreshing?: boolean
      keyboardDismissMode?: 'none' | 'on-drag' | 'interactive'
      keyboardShouldPersistTaps?: 'never' | 'always' | 'handled'
      contentInsetAdjustmentBehavior?: 'automatic' | 'scrollableAxes' | 'never' | 'always'
      /** The keyboard insets the content, and the focused input scrolls above it. */
      automaticallyAdjustKeyboardInsets?: boolean
      /** At most one @scroll per this many milliseconds (the last position always comes); 0, every frame. */
      scrollEventThrottle?: number
      onScroll?: EventHandler<ScrollEvent>
      onRefresh?: () => void
    }>
    TextInput: NativeComponent<
      ModelProps<string> & {
        value?: string
        placeholder?: string
        keyboardType?: 'default' | 'numeric' | 'decimal-pad' | 'email-address' | 'phone-pad' | 'url'
        secureTextEntry?: boolean
        onChangeText?: (text: string) => void
        disabled?: boolean
        onSubmitEditing?: (text: string) => void
        onFocus?: () => void
        onBlur?: () => void
        /** Merged over `style` while the input has focus. */
        focusedStyle?: Style
      }
    >
    Image: NativeComponent<{
      source: string | { uri: string }
      /** What the image shows, for screen readers. Leave it out for decorative images. */
      alt?: string
      resizeMode?: 'cover' | 'contain' | 'stretch' | 'center'
      /** Where downloads are kept: on disk and in memory (the default), in memory only, or not at all. */
      cache?: 'disk' | 'memory' | 'none'
    }>
    Switch: NativeComponent<
      ModelProps<boolean> & { value?: boolean; onValueChange?: (value: boolean) => void }
    >
    ActivityIndicator: NativeComponent<{
      animating?: boolean
      color?: string
      size?: 'small' | 'large'
    }>
    // <svg> as a component: the same drawing. Icons (@nativue/icons) pass `elements` instead.
    Svg: NativeComponent<
      SvgPresentationAttributes & {
        viewBox?: string | [number, number, number, number]
        width?: number | string
        height?: number | string
        preserveAspectRatio?: string
        elements?: SvgElement[]
        color?: string
        strokeWidth?: number
      }
    >
    G: SvgComponent
    Path: SvgComponent<{ d?: string }>
    Circle: SvgComponent<{ cx?: SvgLength; cy?: SvgLength; r?: SvgLength }>
    Ellipse: SvgComponent<{ cx?: SvgLength; cy?: SvgLength; rx?: SvgLength; ry?: SvgLength }>
    Rect: SvgComponent<{
      x?: SvgLength
      y?: SvgLength
      width?: SvgLength
      height?: SvgLength
      rx?: SvgLength
      ry?: SvgLength
    }>
    Line: SvgComponent<{ x1?: SvgLength; y1?: SvgLength; x2?: SvgLength; y2?: SvgLength }>
    Polyline: SvgComponent<{ points?: string }>
    Polygon: SvgComponent<{ points?: string }>
    SvgText: SvgComponent<{
      x?: SvgLength
      y?: SvgLength
      dx?: SvgLength
      dy?: SvgLength
      fontSize?: SvgLength
      fontWeight?: string | number
      fontFamily?: string
      textAnchor?: 'start' | 'middle' | 'end'
    }>
    Tspan: SvgComponent
    Defs: SvgComponent
    LinearGradient: SvgComponent<
      SvgGradientAttributes & { x1?: SvgLength; y1?: SvgLength; x2?: SvgLength; y2?: SvgLength }
    >
    RadialGradient: SvgComponent<
      SvgGradientAttributes & {
        cx?: SvgLength
        cy?: SvgLength
        r?: SvgLength
        fx?: SvgLength
        fy?: SvgLength
      }
    >
    Stop: SvgComponent<{ offset?: SvgLength; stopColor?: string; stopOpacity?: number | string }>
    Modal: NativeComponent<{
      visible?: boolean
      animationType?: 'none' | 'slide' | 'fade'
      presentationStyle?: 'fullScreen' | 'pageSheet' | 'formSheet' | 'overFullScreen'
      transparent?: boolean
      onRequestClose?: () => void
      onShow?: () => void
      onDismiss?: () => void
    }>
    Pressable: typeof Pressable
    FlatList: typeof FlatList
    Swipeable: typeof Swipeable
    ImageBackground: typeof ImageBackground
  }
}
