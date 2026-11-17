// Maps stack frames of the bundle (JavaScriptCore writes them as `name@main.bundle.js:8161:20`) back to
// the app's files with the bundle's source map: `name@src/app/index.vue:22:9`. Consecutive frames from
// outside src/ (Vue, vuenative) collapse into one line, so the app's own frames stand out. Other lines
// are kept.
import { SourceMap } from 'node:module'
import { relative, resolve } from 'node:path'

const FRAME = /^(.*)@(.*main\.bundle\.js):(\d+):(\d+)$/

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
    const frame = FRAME.exec(line)
    if (!frame) return { text: line, isInternal: false }

    const [, name, , lineNumber, columnNumber] = frame
    const entry = sourceMap.findEntry(Number(lineNumber) - 1, Number(columnNumber) - 1)
    if (!entry.originalSource) return { text: line, isInternal: false }

    const path = displayPath(entry.originalSource)
    const text = `${name}@${path}:${entry.originalLine + 1}:${entry.originalColumn + 1}`

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
