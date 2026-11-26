// addNativeListener, onOpenURL, AppState and NativeError, against a fake __native.
import assert from 'node:assert'

let appState = 'active'
globalThis.__native = { appState: () => appState }

const { addNativeListener, AppState, onOpenURL, setURLNavigation } =
  await import('../src/native-events.ts')
const { NativeError, requireNativeFunction } = await import('../src/native-functions.ts')

function test(name, body) {
  body()
  console.log(`ok - ${name}`)
}

async function asyncTest(name, body) {
  await body()
  console.log(`ok - ${name}`)
}

test('calls the listeners of a native event until they are removed', () => {
  const received = []
  const first = addNativeListener('notifications.received', (payload) =>
    received.push(['first', payload]),
  )
  const second = addNativeListener('notifications.received', (payload) => {
    received.push(['second', payload])
    second.remove()
  })

  globalThis.__nativeEvent('notifications.received', { title: 'Hi' })
  globalThis.__nativeEvent('notifications.received', { title: 'Again' })
  globalThis.__nativeEvent('other', 1)
  first.remove()
  globalThis.__nativeEvent('notifications.received', { title: 'Gone' })

  assert.deepStrictEqual(received, [
    ['first', { title: 'Hi' }],
    ['second', { title: 'Hi' }],
    ['first', { title: 'Again' }],
  ])
})

test('lets onOpenURL listeners take a URL before the router', () => {
  const navigated = []
  const seen = []

  setURLNavigation((url) => navigated.push(url))

  const oauth = onOpenURL((url) => {
    seen.push(url)

    return url.startsWith('myapp://oauth')
  })
  const never = onOpenURL((url) => seen.push(`second ${url}`))

  globalThis.__openURL('myapp://oauth?code=1')
  globalThis.__openURL('myapp://items/42')
  oauth.remove()
  never.remove()
  globalThis.__openURL('myapp://oauth?code=2')

  assert.deepStrictEqual(seen, [
    'myapp://oauth?code=1',
    'myapp://items/42',
    'second myapp://items/42',
  ])
  assert.deepStrictEqual(navigated, ['myapp://items/42', 'myapp://oauth?code=2'])
})

test('reads AppState from the native side', () => {
  assert.strictEqual(AppState.current, 'active')

  appState = 'background'

  assert.strictEqual(AppState.current, 'background')
})

await asyncTest('rejects with a NativeError carrying the code', async () => {
  globalThis.__native['pluginAsync:camera.takePhoto'] = (callId) =>
    globalThis.__asyncFunctionFinished(
      callId,
      null,
      'Camera access was denied',
      'ERR_PERMISSION_DENIED',
    )
  globalThis.__native['pluginAsync:camera.legacy'] = (callId) =>
    globalThis.__asyncFunctionFinished(callId, null, 'Failed', null)

  const error = await requireNativeFunction('camera.takePhoto')().catch((rejection) => rejection)
  const legacy = await requireNativeFunction('camera.legacy')().catch((rejection) => rejection)

  assert.ok(error instanceof NativeError && error instanceof Error)
  assert.strictEqual(error.code, 'ERR_PERMISSION_DENIED')
  assert.strictEqual(error.message, 'Camera access was denied')
  assert.strictEqual(legacy.code, undefined)
})

test('removes one subscription of a listener added twice, and isolates a throwing one', () => {
  const received = []
  const shared = (payload) => received.push(payload)
  const first = addNativeListener('shared', shared)

  addNativeListener('shared', shared)
  addNativeListener('shared', () => {
    throw new Error('listener failed')
  })
  first.remove()

  const originalError = console.error

  console.error = () => {}
  globalThis.__nativeEvent('shared', 1)
  console.error = originalError

  assert.deepStrictEqual(received, [1])
})
