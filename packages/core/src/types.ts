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

// Yoga's flexbox (column by default), plus the visual and text properties.
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
  textDecorationLine?: 'none' | 'underline' | 'line-through' | 'underline line-through'
}

export type GestureState = 'began' | 'changed' | 'ended' | 'cancelled' | 'failed'

// @layout: the view's box in its parent, in points.
export interface LayoutEvent {
  x: number
  y: number
  width: number
  height: number
}

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
  reportError(message: string, details: string): void
  windowSize(): { width: number; height: number }
  platform(): 'ios' | 'android'
  colorScheme(): 'light' | 'dark'
  /** Development: the navigation saveNavigation kept, which outlives the JavaScript runtime. */
  savedNavigation(): string | null
  saveNavigation(routes: string): void
  accessibilityInfo(): { screenReaderEnabled: boolean; reduceMotionEnabled: boolean }
  announce(message: string): void
  create(id: number, type: string): void
  insert(parentId: number, childId: number, index: number): void
  /** Detaches the view `id`; `subtreeIds` (it and every native descendant) are forgotten. */
  remove(id: number, subtreeIds: number[]): void
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

  /** Starts an HTTP request; its progress comes back through __networkEvent. */
  sendRequest(requestId: number, request: NativeRequest): void
  abortRequest(requestId: number): void

  /** Joins the parts into new native bytes; null if a part's blob has been released. */
  blobCreate(parts: NativeBlobPart[]): { blobId: string; size: number } | null
  /** UTF-8 text, base64 (for data URLs) or the bytes themselves; null once released. */
  blobRead(blobId: string, offset: number, size: number, encoding: 'text' | 'base64'): string | null
  blobRead(blobId: string, offset: number, size: number, encoding: 'bytes'): Uint8Array | null
  blobRelease(blobId: string): void
}

/** Bytes held natively: a Blob's, or a slice of them. */
export interface NativeBlob {
  blobId: string
  offset: number
  size: number
  type: string
}

export type NativeBlobPart = { string: string } | { bytes: Uint8Array } | { blob: NativeBlob }

export interface NativeRequest {
  method: string
  url: string
  headers: Record<string, string>
  body: NativeRequestBody
  /** 'bytes' for arraybuffer responses; 'blob' keeps the bytes native. */
  responseType: 'text' | 'bytes' | 'blob'
  /** Send the text as it arrives (incrementaldata) and download progress, not just the whole at the end. */
  incrementalUpdates: boolean
  /** In milliseconds; 0 for the platform's. */
  timeout: number
  withCredentials: boolean
}

// Text, bytes, a file native reads by uri, or the parts of a multipart/form-data body.
export type NativeRequestBody =
  | null
  | { string: string }
  | { bytes: Uint8Array }
  | { uri: string }
  | { blob: NativeBlob }
  | { formData: NativeFormDataPart[] }

export type NativeFormDataPart =
  | { name: string; value: string }
  | { name: string; uri: string; filename: string; type: string }
  | { name: string; blob: NativeBlob; filename: string; type: string }

/** What native reports about a request, by event name. */
export interface NetworkEventPayloads {
  uploadprogress: { loaded: number; total: number }
  response: { status: number; headers: Record<string, string>; url: string }
  /** The whole response, once: text, the bytes for 'bytes', a NativeBlob for 'blob'. Not sent after incrementaldata. */
  data: { data: string | Uint8Array | NativeBlob }
  incrementaldata: { text: string; loaded: number; total: number }
  progress: { loaded: number; total: number }
  /** The end: `error` set when it failed. */
  complete: { error: string | null; timedOut: boolean }
}
