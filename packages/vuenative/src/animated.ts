// Animated, like React Native's with the native driver: values live on the native side, which updates
// the views bound to them (opacity and transform) and runs animations on every frame, with no JS per
// frame. JS only hears back when an animation finishes.
//
//   const opacity = new Animated.Value(0)
//   Animated.timing(opacity, { toValue: 1, duration: 300 }).start()
//   <View :style="{ opacity }" />
//
// Create values and interpolations once (in setup), not in render: each one is a native node.
import type { Style } from './types'

const native = globalThis.__native

const ANIMATED_EVENT = Symbol('animated event')
const finishCallbacksByAnimationId: Record<number, AnimationCallback> = {}
let nextNodeId = 1
let nextAnimationId = 1

type AnimationCallback = (result: { finished: boolean }) => void
type Easing = 'easeInOut' | 'easeIn' | 'easeOut' | 'linear'

interface AnimationConfig {
  type: 'timing' | 'spring'
  toValue: number
  iterations?: number
  [option: string]: unknown
}

export interface Animation {
  value: AnimatedValue
  config: AnimationConfig
  start(callback?: AnimationCallback): void
  stop(): void
}

export interface AnimatedEvent<Payload> {
  [ANIMATED_EVENT]: Partial<Record<keyof Payload, AnimatedValue>>
  listener?: (payload: Payload) => void
}

interface StyleBinding {
  opacity?: number
  transform?: ({ name: string; node: number } | { name: string; value: number })[]
}

// '360deg' -> radians, so native only deals with numbers.
function numericValue(value: number | string): number {
  if (typeof value === 'number') return value

  const number = parseFloat(value)

  return value.endsWith('deg') ? (number * Math.PI) / 180 : number
}

export class AnimatedNode {
  readonly id = nextNodeId++

  constructor(config: object) {
    native.createAnimatedNode(this.id, config)
  }

  // extrapolate: 'extend' (default) keeps the slope past the ends; 'clamp' stops at them.
  interpolate({
    inputRange,
    outputRange,
    extrapolate = 'extend',
  }: {
    inputRange: number[]
    outputRange: (number | string)[]
    extrapolate?: 'extend' | 'clamp'
  }): AnimatedNode {
    return new AnimatedNode({
      type: 'interpolation',
      parent: this.id,
      inputRange,
      outputRange: outputRange.map(numericValue),
      extrapolate,
    })
  }
}

class AnimatedValue extends AnimatedNode {
  constructor(value = 0) {
    super({ type: 'value', value })
  }

  // Also stops an animation running on this value.
  setValue(value: number): void {
    native.setAnimatedValue(this.id, value)
  }
}

function createAnimation(value: AnimatedValue, config: AnimationConfig): Animation {
  return {
    value,
    config,

    // callback({ finished }): finished is false when stopped or interrupted.
    start(callback) {
      const animationId = nextAnimationId++
      if (callback) finishCallbacksByAnimationId[animationId] = callback

      native.startAnimation(animationId, value.id, config)
    },

    stop() {
      native.stopAnimation(value.id)
    },
  }
}

globalThis.__animationFinished = (animationId, finished) => {
  const callback = finishCallbacksByAnimationId[animationId]
  delete finishCallbacksByAnimationId[animationId]

  callback?.({ finished })
}

export function isAnimatedNode(value: unknown): value is AnimatedNode {
  return value instanceof AnimatedNode
}

export function isAnimatedEvent(handler: unknown): handler is AnimatedEvent<unknown> {
  return typeof handler === 'object' && handler != null && ANIMATED_EVENT in handler
}

// { translationX: x } -> { translationX: x.id }: what native writes where.
export function animatedEventMapping(handler: AnimatedEvent<unknown>): Record<string, number> {
  const mapping: Record<string, AnimatedValue | undefined> = handler[ANIMATED_EVENT]

  return Object.fromEntries(Object.entries(mapping).map(([key, value]) => [key, value!.id]))
}

// Only opacity and transform can follow values natively (like RN's native driver: no layout props).
// Returns what native binds, or null when the style has no animated values.
export function animatedStyleBinding(style: Style | null | undefined): StyleBinding | null {
  if (!style) return null

  const binding: StyleBinding = {}

  if (isAnimatedNode(style.opacity)) binding.opacity = style.opacity.id

  const stepEntries = (style.transform ?? []).map(
    (step) => Object.entries(step)[0] as [string, number | string | AnimatedNode],
  )

  if (stepEntries.some(([, value]) => isAnimatedNode(value))) {
    binding.transform = stepEntries.map(([name, value]) =>
      isAnimatedNode(value) ? { name, node: value.id } : { name, value: numericValue(value) },
    )
  }

  return Object.keys(binding).length > 0 ? binding : null
}

export const Animated = {
  Value: AnimatedValue,

  // easing: 'easeInOut' (default), 'easeIn', 'easeOut' or 'linear'; duration in ms.
  timing(
    value: AnimatedValue,
    {
      toValue,
      duration = 500,
      easing = 'easeInOut',
    }: { toValue: number; duration?: number; easing?: Easing },
  ): Animation {
    return createAnimation(value, { type: 'timing', toValue, duration, easing })
  },

  spring(
    value: AnimatedValue,
    {
      toValue,
      stiffness = 100,
      damping = 10,
      mass = 1,
      velocity = 0,
    }: { toValue: number; stiffness?: number; damping?: number; mass?: number; velocity?: number },
  ): Animation {
    return createAnimation(value, { type: 'spring', toValue, stiffness, damping, mass, velocity })
  },

  // Repeats `animation` from its starting value; iterations -1 is forever.
  loop(animation: Animation, { iterations = -1 }: { iterations?: number } = {}): Animation {
    return createAnimation(animation.value, { ...animation.config, iterations })
  },

  // Writes event fields straight into values on the native side:
  //   const handlePan = Animated.event<PanEvent>({ translationX: x }, { listener })
  //   <View :on-pan="handlePan" />
  // Bind it with v-bind (:on-pan), not @pan: Vue wraps @ handlers in a function, hiding the mapping.
  // Works with @pan / @pinch / @rotate (their fields) and a ScrollView's @scroll ({ x, y }). While
  // mapped, the listener only hears a gesture's began / ended / cancelled, not every frame.
  event<Payload>(
    mapping: Partial<Record<keyof Payload, AnimatedValue>>,
    { listener }: { listener?: (payload: Payload) => void } = {},
  ): AnimatedEvent<Payload> {
    return { [ANIMATED_EVENT]: mapping, listener }
  },
}

// So apps can write `Animated.Value` as a type too, like React Native.
export namespace Animated {
  export type Value = AnimatedValue
}
