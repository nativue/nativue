// Types of the native components (<View>, <Text>...) so templates get autocomplete and checks.
// Events are listed as on* props: @press is onPress, @change-text is onChangeText.
import type { DefineComponent } from '@vue/runtime-core'
import type { AnimatedEvent } from './animated'
import type { FlatList, Pressable, Swipeable } from './components'
import type { PanEvent, PinchEvent, RotateEvent, ScrollEvent, Style } from './types'

type NativeComponent<Props = {}> = DefineComponent<Props & { style?: Style }>
type EventHandler<Payload> = ((payload: Payload) => void) | AnimatedEvent<Payload>
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
        onSubmitEditing?: (text: string) => void
      }
    >
    Image: NativeComponent<{
      source: string | { uri: string }
      resizeMode?: 'cover' | 'contain' | 'stretch' | 'center'
    }>
    Switch: NativeComponent<
      ModelProps<boolean> & { value?: boolean; onValueChange?: (value: boolean) => void }
    >
    ActivityIndicator: NativeComponent<{
      animating?: boolean
      color?: string
      size?: 'small' | 'large'
    }>
    // Low level: draws SVG elements, e.g. an icon set's nodes (see @nativue/icons).
    Svg: NativeComponent<{
      viewBox?: [number, number, number, number]
      elements: SvgElement[]
      color?: string
      strokeWidth?: number
    }>
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
  }
}
