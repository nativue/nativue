// The web APIs JavaScript engines don't have, built on the native bridge: console and timers. Runs
// first, before any other module. Engines (and Node, in tests) that have them keep theirs.
const timerCallbacks = new Map<number, () => void>()
let nextTimerId = 1

function log(...values: unknown[]) {
  __native.log(values.map(String).join(' '))
}

function armTimer(timerId: number, callback: () => void, delay: number) {
  timerCallbacks.set(timerId, callback)
  __native.setTimer(timerId, delay)
}

function millisecondsOf(delay: number | undefined) {
  return Math.max(0, Math.round(delay ?? 0))
}

globalThis.console ??= { log, info: log, warn: log, error: log }

globalThis.setTimeout ??= (callback, delay, ...args) => {
  const timerId = nextTimerId++
  armTimer(timerId, () => callback(...args), millisecondsOf(delay))

  return timerId
}

// Re-arms before running the callback, so clearInterval inside it still stops the interval.
globalThis.setInterval ??= (callback, delay, ...args) => {
  const timerId = nextTimerId++
  const interval = millisecondsOf(delay)
  const tick = () => {
    armTimer(timerId, tick, interval)
    callback(...args)
  }
  armTimer(timerId, tick, interval)

  return timerId
}

globalThis.clearTimeout ??= (timerId) => {
  if (timerId != null) timerCallbacks.delete(timerId)
}

globalThis.clearInterval ??= globalThis.clearTimeout

// Native calls it when a timer's delay has passed.
globalThis.__fireTimer = (timerId) => {
  const callback = timerCallbacks.get(timerId)
  timerCallbacks.delete(timerId)
  callback?.()
}
