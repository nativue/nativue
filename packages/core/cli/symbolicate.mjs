// Maps stack frames of the bundle (and of hot updates) back to the app's files with their source maps:
// Hermes' `at name (main.bundle.js:8161:20)` becomes `at name (src/app/index.vue:22:9)`. Consecutive
// frames from outside src/ (Vue, nativue, Hermes' native ones) collapse into one line, so the app's
// own frames stand out. Other lines are kept.
import { SourceMap } from 'node:module'
import { relative, resolve } from 'node:path'

// Groups: before the location, the file, the location's line and column, after it.
const HERMES_FRAME = /^(\s*at .* \()(?:.*\/)?([^/()]+\.js):(\d+):(\d+)(\))$/
const HERMES_NATIVE_FRAME = /^\s*at .* \(native\)$/

export function framedFiles(text) {
  return new Set(text.split('\n').flatMap((line) => HERMES_FRAME.exec(line)?.[2] ?? []))
}

// sourceMapsByFile: for each file (main.bundle.js, a hot update), { sourceMap: the map as JSON,
// directory: the one its sources are relative to, lineOffset: how many lines above the file's first
// line the map starts }.
export function createSymbolicator(sourceMapsByFile) {
  const mapsByFile = new Map(
    Object.entries(sourceMapsByFile).map(([file, { sourceMap, directory, lineOffset = 0 }]) => [
      file,
      { sourceMap: new SourceMap(sourceMap), directory, lineOffset },
    ]),
  )

  function displayPath(directory, source) {
    const absolutePath = resolve(directory, source)
    const nodeModulesIndex = absolutePath.lastIndexOf('node_modules/')

    return nodeModulesIndex === -1
      ? relative(process.cwd(), absolutePath)
      : absolutePath.slice(nodeModulesIndex)
  }

  // { text, isInternal }: internal frames are those mapped outside the app's src/.
  function symbolicateLine(line) {
    if (HERMES_NATIVE_FRAME.test(line)) return { text: line, isInternal: true }

    const [, before, file, lineNumber, columnNumber, after] = HERMES_FRAME.exec(line) ?? []
    const map = mapsByFile.get(file)
    if (!map) return { text: line, isInternal: false }

    const { sourceMap, directory, lineOffset } = map
    const entry = sourceMap.findEntry(Number(lineNumber) - 1 - lineOffset, Number(columnNumber) - 1)
    if (!entry.originalSource) return { text: line, isInternal: false }

    const path = displayPath(directory, entry.originalSource)
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
