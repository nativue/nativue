# Animations and gestures

Animations run on the native side: once started, they update the view on every frame without
JavaScript, so they stay smooth while your code is busy. JavaScript only hears back when an
animation finishes.

## Animated

```vue
<script setup lang="ts">
import { Animated } from 'vue'

const opacity = new Animated.Value(0)

function fadeIn() {
  Animated.timing(opacity, { toValue: 1, duration: 300 }).start()
}
</script>

<template>
  <View :style="{ opacity }" />
</template>
```

Animated values drive `opacity` and `transform`. Create values and interpolations once, in `setup`,
not while rendering: each one lives on the native side.

### Values

|                                                               |                                                 |
| ------------------------------------------------------------- | ----------------------------------------------- |
| `new Animated.Value(start = 0)`                               | a number that animations change                 |
| `value.setValue(number)`                                      | jumps to a number, stopping a running animation |
| `value.interpolate({ inputRange, outputRange, extrapolate })` | maps it to another range, see below             |

`Animated.Value` is also a type: `const offset: Animated.Value = new Animated.Value(0)`.

### Animations

|                                            | Options                                                                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `Animated.timing(value, options)`          | `toValue`; `duration` in ms (500); `easing`: `'easeInOut'` (default), `'easeIn'`, `'easeOut'`, `'linear'` |
| `Animated.spring(value, options)`          | `toValue`; `stiffness` (100), `damping` (10), `mass` (1), `velocity` (0)                                  |
| `Animated.loop(animation, { iterations })` | repeats it from its start; `iterations: -1` (default) is forever                                          |

Each returns an animation with `start(callback?)` and `stop()`. The callback receives
`{ finished }`, which is `false` when the animation was stopped or interrupted:

```ts
Animated.spring(scale, { toValue: 1.2 }).start(({ finished }) => {
  if (finished) Animated.spring(scale, { toValue: 1 }).start()
})
```

### Interpolation

```ts
const progress = new Animated.Value(0)
const rotate = progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })
const opacity = progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 0] })
```

```vue
<View :style="{ opacity, transform: [{ rotate }] }" />
```

`extrapolate: 'extend'` (default) keeps going past the ends of the range; `'clamp'` stops at them.

## Gestures

Any [`View`](components/view.md) reports gestures:

| Event     | Payload                                                       |
| --------- | ------------------------------------------------------------- |
| `@pan`    | `{ state, translationX, translationY, velocityX, velocityY }` |
| `@pinch`  | `{ state, scale, velocity }`                                  |
| `@rotate` | `{ state, rotation, velocity }` (radians)                     |

`state` is `'began'`, `'changed'`, `'ended'`, `'cancelled'` or `'failed'`. Distances are in points
and velocities in points per second.

### Following the finger natively

`Animated.event` writes a gesture's fields straight into animated values, so the view follows the
finger without JavaScript on every frame:

```vue
<script setup lang="ts">
import { Animated, type PanEvent } from 'vue'

const translateX = new Animated.Value(0)
const translateY = new Animated.Value(0)

const handlePan = Animated.event<PanEvent>(
  { translationX: translateX, translationY: translateY },
  {
    listener: ({ state }) => {
      if (state !== 'ended') return

      Animated.spring(translateX, { toValue: 0 }).start()
      Animated.spring(translateY, { toValue: 0 }).start()
    },
  },
)
</script>

<template>
  <View :on-pan="handlePan" :style="{ transform: [{ translateX }, { translateY }] }" />
</template>
```

Bind it with `:on-pan`, not `@pan`: Vue wraps `@` handlers in a function, which hides the mapping.
While mapped, the `listener` only hears a gesture's start and end, not every frame.

## Scroll

`Animated.event` also works on a [`ScrollView`](components/scroll-view.md)'s scroll, with `x` and `y`,
for collapsing headers and parallax:

```ts
const scrollY = new Animated.Value(0)
const handleScroll = Animated.event<ScrollEvent>({ y: scrollY })
const headerOpacity = scrollY.interpolate({
  inputRange: [0, 120],
  outputRange: [1, 0],
  extrapolate: 'clamp',
})
```

```vue
<ScrollView :on-scroll="handleScroll">
```

## LayoutAnimation

`LayoutAnimation` animates the next layout change: views that move, resize, appear or disappear
slide into place, along with color, opacity and transform changes. Call it right before changing
state:

```ts
import { LayoutAnimation } from 'vue'

function remove(item: Item) {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.spring)
  items.value.splice(items.value.indexOf(item), 1)
}
```

| Preset                                  |                       |
| --------------------------------------- | --------------------- |
| `LayoutAnimation.Presets.easeInEaseOut` | 300 ms (the default)  |
| `LayoutAnimation.Presets.linear`        | 500 ms                |
| `LayoutAnimation.Presets.spring`        | 700 ms, with a bounce |

Or pass your own: `{ type: 'easeInEaseOut' | 'linear' | 'spring', duration, springDamping? }`.
