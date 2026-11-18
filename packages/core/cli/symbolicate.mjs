// Maps stack frames of the bundle back to the app's files with the bundle's source map: Hermes'
// `at name (main.bundle.js:8161:20)` becomes `at name (src/app/index.vue:22:9)`. Consecutive
// frames from outside src/ (Vue, nativue, Hermes' native ones) collapse into one line, so the app's
// own frames stand out. Other lines are kept.
import { SourceMap } from 'node:module'
import { relative, resolve } from 'node:path'

// Groups: before the location, the location's line and column, after it.
const HERMES_FRAME = /^(\s*at .* \()(?:.*main\.bundle\.js):(\d+):(\d+)(\))$/
const HERMES_NATIVE_FRAME = /^\s*at .* \(native\)$/

// sourceMapPayload: the map as JSON; its sources are relative to bundleDirectory.
export function createSymbolicator(sourceMapPayload, bundleDirectory) {
  const sourceMap = new SourceMap(sourceMapPayload)

  function displayPath(source) {
    const absolutePath = resolve(bundleDirectory, source)
    const nodeModulesIndex = absolutePath.lastIndexOf('node_modules/')

    return nodeModulesIndex === -1
      ? relative(process.cwd(), absolutePath)
      : absolutePath.slice(nodeModulesIndex)
  }

  // { text, isInternal }: internal frames are those mapped outside the app's src/.
  function symbolicateLine(line) {
    if (HERMES_NATIVE_FRAME.test(line)) return { text: line, isInternal: true }

    const frame = HERMES_FRAME.exec(line)
    if (!frame) return { text: line, isInternal: false }

    const [, before, lineNumber, columnNumber, after] = frame
    const entry = sourceMap.findEntry(Number(lineNumber) - 1, Number(columnNumber) - 1)
    if (!entry.originalSource) return { text: line, isInternal: false }

    const path = displayPath(entry.originalSource)
    const text = `${before}${path}:${entry.originalLine + 1}:${entry.originalColumn + 1}${after}`

    return { text, isInternal: !path.startsWith('src/') }
  }

  function collapseInternalFrames(lines) {
    const collapsed = []
    let internalCount = 0

    function flushInternalFrames() {
      if (internalCount > 0) collapsed.push(`… ${internalCount} framework frame(s)`)
      internalCount = 0
    }

    for (const { text, isInternal } of lines) {
      if (isInternal) {
        internalCount++
        continue
      }

      flushInternalFrames()
      collapsed.push(text)
    }
    flushInternalFrames()

    return collapsed
  }

  return (text) => collapseInternalFrames(text.split('\n').map(symbolicateLine)).join('\n')
}
