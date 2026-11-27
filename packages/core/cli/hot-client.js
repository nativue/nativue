// Hot module replacement in the app: runs before the dev bundle, after Rolldown's DevRuntime. The dev
// server fills in __NATIVUE_HOT__ ({ clientId, serverURL }). Native code calls __hotUpdate(json) for
// each `data: hot` line; anything that can't be applied asks Vite for a full reload.
;(() => {
  const { clientId, serverURL } = __NATIVUE_HOT__
  const acceptCallbacksById = new Map()
  const disposersById = new Map()
  const dataById = new Map()
  const listenersById = new Map()
  let lastSequence = 0
  let isReloadPending = false
  let queue = Promise.resolve()

  function send(event, data) {
    fetch(`${serverURL}/hot`, {
      method: 'POST',
      body: JSON.stringify({ clientId, message: { type: 'custom', event, data } }),
    }).catch(() => {})
  }

  // What the console prints, also in the dev server's terminal: one request at a time, so it keeps
  // the order, with what was printed meanwhile.
  const pendingLogs = []
  let isSendingLogs = false

  function sendLogs() {
    if (isSendingLogs || pendingLogs.length === 0) return

    isSendingLogs = true
    fetch(`${serverURL}/log`, {
      method: 'POST',
      body: JSON.stringify({ platform: __native.platform(), entries: pendingLogs.splice(0) }),
    })
      .catch(() => {})
      .finally(() => {
        isSendingLogs = false
        sendLogs()
      })
  }

  globalThis.__nativueOnLog = (level, text) => {
    pendingLogs.push({ level, text })
    sendLogs()
  }

  function requestReload(reason) {
    if (isReloadPending) return

    isReloadPending = true
    console.log(`[nativue] reload: ${reason}`)
    send('vite:bundled-dev:reload-needed', { reason })
  }

  function hotContext(id) {
    if (!dataById.has(id)) dataById.set(id, {})
    acceptCallbacksById.set(id, [])
    listenersById.set(id, [])

    const accept = (deps, callback) => acceptCallbacksById.get(id).push({ deps, callback })

    return {
      get data() {
        return dataById.get(id)
      },

      accept(deps, callback) {
        if (typeof deps === 'function' || !deps) accept([id], ([module]) => deps?.(module))
        else if (typeof deps === 'string') accept([deps], ([module]) => callback?.(module))
        else accept(deps, callback ?? (() => {}))
      },

      acceptExports(_names, callback) {
        accept([id], ([module]) => callback?.(module))
      },

      dispose(callback) {
        disposersById.set(id, callback)
      },

      invalidate() {
        requestReload(`${id} invalidated itself`)
      },

      on(event, callback) {
        listenersById.get(id).push({ event, callback })
      },

      off(event, callback) {
        const listeners = listenersById.get(id)
        listenersById.set(
          id,
          listeners.filter(
            (listener) => listener.callback !== callback || listener.event !== event,
          ),
        )
      },

      send(event, data) {
        send(event, data)
      },

      prune() {},
      decline() {},
    }
  }

  const acceptsDependency = (parent, id) =>
    (acceptCallbacksById.get(parent) ?? []).some(({ deps }) => deps.includes(id))

  function findBoundaries(changedIds) {
    const boundaries = []
    const updateSet = new Set()

    function bubble(id) {
      if (updateSet.has(id)) return

      updateSet.add(id)
      if (acceptsDependency(id, id)) return boundaries.push({ boundary: id, acceptedVia: id })

      for (const parent of runtime
        .getImporters(id)
        .filter((parent) => runtime.isExecuted(parent))) {
        if (acceptsDependency(parent, id)) boundaries.push({ boundary: parent, acceptedVia: id })
        else bubble(parent)
      }
    }

    for (const id of changedIds) if (runtime.isExecuted(id)) bubble(id)

    return { boundaries, updateSet }
  }

  function hasEntryWithoutBoundary({ boundaries, updateSet }) {
    const reRun = new Set()
    const pending = boundaries.map(({ acceptedVia }) => acceptedVia)

    while (pending.length > 0) {
      const id = pending.pop()
      if (reRun.has(id) || !updateSet.has(id)) continue

      reRun.add(id)
      pending.push(...(runtime.staticImports.get(id)?.edges ?? []))
    }

    return [...updateSet].some((id) => runtime.isEntry(id) && !reRun.has(id))
  }

  async function apply({ changedIds, url, seq }) {
    if (isReloadPending) return
    if (seq !== lastSequence + 1) return requestReload('missed an update')

    lastSequence = seq

    const update = findBoundaries(changedIds)
    if (update.updateSet.size === 0) return
    if (hasEntryWithoutBoundary(update)) return requestReload(`${changedIds.join(', ')} changed`)

    const patch = await (await fetch(`${serverURL}/${url}`)).text()
    ;(0, eval)(`${patch}\n//# sourceURL=${url}`)

    if ([...update.updateSet].some((id) => !runtime.hasFactory(id))) {
      return requestReload('a module is missing from the update')
    }

    const applies = update.boundaries.map(({ boundary, acceptedVia }) => ({
      acceptedVia,
      callbacks: acceptCallbacksById.get(boundary).filter(({ deps }) => deps.includes(acceptedVia)),
    }))

    for (const id of update.updateSet) runtime.removeModuleCache(id)
    for (const { acceptedVia, callbacks } of applies) {
      runtime.initModule(acceptedVia)

      const exports = runtime.loadExports(acceptedVia)
      for (const { deps, callback } of callbacks) {
        callback(deps.map((dep) => (dep === acceptedVia ? exports : undefined)))
      }
    }

    console.log(`[nativue] hot updated ${changedIds.join(', ')}`)
  }

  function notifyListeners(event, data) {
    for (const listeners of listenersById.values()) {
      for (const listener of listeners) if (listener.event === event) listener.callback(data)
    }
  }

  class NativueDevRuntime extends DevRuntime {
    payloadDelivered(filename) {
      send('vite:bundled-dev:payload-delivered', { filename })
    }

    createModuleHotContext(id) {
      return hotContext(id)
    }
  }

  const runtime = new NativueDevRuntime(clientId)
  runtime.hooks = {
    createModuleHotContext: (id) => runtime.createModuleHotContext(id),
    onModuleCacheRemoval: (id) => disposersById.get(id)?.(dataById.get(id)),
  }
  globalThis.__rolldown_runtime__ = runtime

  globalThis.__hotUpdate = (json) => {
    const update = JSON.parse(json)
    if (update.type === 'custom') return notifyListeners(update.event, update.data)
    if (update.clientId !== clientId) return

    send('nativue:received')

    queue = queue
      .then(() => apply(update))
      .catch((error) => requestReload(error?.message ?? String(error)))
  }
})()
