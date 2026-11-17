// Animated, like React Native's with the native driver: values live on the native side, which updates
// the views bound to them (opacity and transform) and runs animations on every frame, with no JS per
// frame. JS only hears back when an animation finishes.
//
//   const opacity = new Animated.Value(0)
//   Animated.timing(opacity, { toValue: 1, duration: 300 }).start()
//   <View :style="{ opacity }" />
//
// Create values and interpolations once (in setup), not in render: each one is a native node.
const native = globalThis.__native

const ANIMATED_EVENT = Symbol('animated event')
const finishCallbacksByAnimationId = {}
let nextNodeId = 1
let nextAnimationId = 1

// '360deg' -> radians, so native only deals with numbers.
function numericValue(value) {
  if (typeof value === 'number') return value

  const number = parseFloat(value)

  return value.endsWith('deg') ? (number * Math.PI) / 180 : number
}

class AnimatedNode {
  constructor(config) {
    this.id = nextNodeId++
    native.createAnimatedNode(this.id, config)
  }

  // extrapolate: 'extend' (default) keeps the slope past the ends; 'clamp' stops at them.
  interpolate({ inputRange, outputRange, extrapolate = 'extend' }) {
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
  setValue(value) {
    native.setAnimatedValue(this.id, value)
  }
}

function createAnimation(value, config) {
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

export function isAnimatedNode(value) {
  return value instanceof AnimatedNode
}

export function isAnimatedEvent(handler) {
  return Boolean(handler?.[ANIMATED_EVENT])
}

// { translationX: x } -> { translationX: x.id }: what native writes where.
export function animatedEventMapping(handler) {
  const mapping = handler[ANIMATED_EVENT]

  return Object.fromEntries(Object.entries(mapping).map(([key, value]) => [key, value.id]))
}

// Only opacity and transform can follow values natively (like RN's native driver: no layout props).
// Returns what native binds, or null when the style has no animated values.
export function animatedStyleBinding(style) {
  if (!style) return null

  const binding = {}

  if (isAnimatedNode(style.opacity)) binding.opacity = style.opacity.id

  const transform = Array.isArray(style.transform) ? style.transform : []
  const stepEntries = transform.map((step) => Object.entries(step)[0])

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
  timing(value, { toValue, duration = 500, easing = 'easeInOut' }) {
    return createAnimation(value, { type: 'timing', toValue, duration, easing })
  },

  spring(value, { toValue, stiffness = 100, damping = 10, mass = 1, velocity = 0 }) {
    return createAnimation(value, { type: 'spring', toValue, stiffness, damping, mass, velocity })
  },

  // Repeats `animation` from its starting value; iterations -1 is forever.
  loop(animation, { iterations = -1 } = {}) {
    return createAnimation(animation.value, { ...animation.config, iterations })
  },

  // Writes event fields straight into values on the native side:
  //   const handlePan = Animated.event({ translationX: x }, { listener })
  //   <View :on-pan="handlePan" />
  // Bind it with v-bind (:on-pan), not @pan: Vue wraps @ handlers in a function, hiding the mapping.
  // Works with @pan / @pinch / @rotate (their fields) and a ScrollView's @scroll ({ x, y }). While
  // mapped, the listener only hears a gesture's began / ended / cancelled, not every frame.
  event(mapping, { listener } = {}) {
    return { [ANIMATED_EVENT]: mapping, listener }
  },
}
