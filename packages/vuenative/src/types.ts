// Types shared by the framework and apps: styles, native events and the bridge to the native side.
import type { AnimatedNode } from './animated'

type Dimension = number | 'auto' | `${number}%`
type Edge = '' | 'Top' | 'Right' | 'Bottom' | 'Left' | 'Horizontal' | 'Vertical' | 'Start' | 'End'
type ColorValue = string

export type TransformStep =
  | { translateX: number | AnimatedNode }
  | { translateY: number | AnimatedNode }
  | { scale: number | AnimatedNode }
  | { scaleX: number | AnimatedNode }
  | { scaleY: number | AnimatedNode }
  | { rotate: string | number | AnimatedNode } // '45deg', or radians

// Like React Native's: Yoga's flexbox (column by default), plus the visual and text properties.
export type Style = {
  [property in `margin${Edge}` | `padding${Edge}`]?: Dimension
} & {
  display?: 'flex' | 'none'
  position?: 'relative' | 'absolute' | 'static'
  top?: Dimension
  right?: Dimension
  bottom?: Dimension
  left?: Dimension
  width?: Dimension
  height?: Dimension
  minWidth?: Dimension
  minHeight?: Dimension
  maxWidth?: Dimension
  maxHeight?: Dimension
  aspectRatio?: number
  flex?: number
  flexGrow?: number
  flexShrink?: number
  flexBasis?: Dimension
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse'
  flexWrap?: 'wrap' | 'nowrap' | 'wrap-reverse'
  justifyContent?:
    'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly'
  alignItems?: 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline'
  alignSelf?: 'auto' | 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline'
  alignContent?: 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'space-between' | 'space-around'
  gap?: number
  rowGap?: number
  columnGap?: number
  overflow?: 'visible' | 'hidden' | 'scroll'

  backgroundColor?: ColorValue
  borderColor?: ColorValue
  borderWidth?: number
  borderRadius?: number
  opacity?: number | AnimatedNode
  transform?: TransformStep[]
  shadowColor?: ColorValue
  shadowOpacity?: number
  shadowRadius?: number
  shadowOffset?: { width: number; height: number }

  color?: ColorValue
  fontSize?: number
  fontWeight?:
    'normal' | 'bold' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900'
  textAlign?: 'auto' | 'left' | 'right' | 'center' | 'justify'
}

export type GestureState = 'began' | 'changed' | 'ended' | 'cancelled' | 'failed'

export interface ScrollEvent {
  x: number
  y: number
  width: number
  height: number
}

export interface PanEvent {
  state: GestureState
  translationX: number
  translationY: number
  velocityX: number
  velocityY: number
}

export interface PinchEvent {
  state: GestureState
  scale: number
  velocity: number
}

export interface RotateEvent {
  state: GestureState
  rotation: number // radians
  velocity: number
}

export interface LayoutAnimationConfig {
  type: 'easeInEaseOut' | 'linear' | 'spring'
  duration: number
  springDamping?: number
}

/** Functions the native side exposes as globalThis.__native (see Bridge.swift). */
export interface NativeModule {
  log(message: string): void
  windowSize(): { width: number; height: number }
  create(id: number, type: string): void
  insert(parentId: number, childId: number, index: number): void
  remove(id: number): void
  setProp(id: number, key: string, value: unknown): void
  setText(id: number, text: string): void
  setTimer(timerId: number, delay: number): void
  dismissKeyboard(): void
  configureNextLayoutAnimation(config: LayoutAnimationConfig): void

  createAnimatedNode(id: number, config: object): void
  setAnimatedValue(id: number, value: number): void
  startAnimation(animationId: number, nodeId: number, config: object): void
  stopAnimation(nodeId: number): void
  setAnimatedStyle(viewId: number, binding: object | null): void
  setAnimatedEvent(viewId: number, eventName: string, mapping: Record<string, number> | null): void

  storageGet(key: string): string | null
  storageSet(key: string, value: string): void
  storageRemove(key: string): void
  storageKeys(): string[]
  storageClear(): void

  fetch(
    requestId: number,
    url: string,
    method: string,
    headers: Record<string, string>,
    body: string | null,
  ): void
}
