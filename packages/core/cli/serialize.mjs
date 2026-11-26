// Writers for the native files prebuild generates from plain objects: plists, the Xcode project
// (an OpenStep plist) and Android XML. Only writers: nativue builds these files, it never reads them.

const PLIST_HEADER = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
`

export function escapeXml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function escapeXmlAttribute(text) {
  return escapeXml(text).replaceAll('"', '&quot;')
}

function plistValue(value, depth) {
  const indent = '\t'.repeat(depth)

  if (typeof value === 'boolean') return `${indent}<${value}/>`
  if (typeof value === 'number') {
    const type = Number.isInteger(value) ? 'integer' : 'real'

    return `${indent}<${type}>${value}</${type}>`
  }
  if (typeof value === 'string') return `${indent}<string>${escapeXml(value)}</string>`
  if (Array.isArray(value)) {
    if (value.length === 0) return `${indent}<array/>`

    const items = value.map((item) => plistValue(item, depth + 1))

    return [`${indent}<array>`, ...items, `${indent}</array>`].join('\n')
  }

  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
  if (keys.length === 0) return `${indent}<dict/>`

  const entries = keys.flatMap((key) => [
    `${indent}\t<key>${escapeXml(key)}</key>`,
    plistValue(value[key], depth + 1),
  ])

  return [`${indent}<dict>`, ...entries, `${indent}</dict>`].join('\n')
}

/** An XML property list (Info.plist, entitlements). Keys are sorted, as Xcode writes them. */
export function plist(dictionary) {
  return `${PLIST_HEADER}${plistValue(dictionary, 0)}\n</plist>\n`
}

// Strings the OpenStep format leaves unquoted; anything else is quoted and escaped.
const OPENSTEP_BARE_STRING = /^[A-Za-z0-9_$./]+$/
// Objects Xcode writes on a single line.
const SINGLE_LINE_ISAS = new Set(['PBXBuildFile', 'PBXFileReference'])

function openStepString(text) {
  if (OPENSTEP_BARE_STRING.test(text)) return text

  const escaped = text.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')

  return `"${escaped}"`
}

/** isa first, then the rest in alphabetical order: Xcode's own order, so saving in Xcode changes nothing. */
function sortedKeys(dictionary) {
  const keys = Object.keys(dictionary).filter(
    (key) => key !== 'isa' && dictionary[key] !== undefined,
  )

  keys.sort()

  return 'isa' in dictionary ? ['isa', ...keys] : keys
}

/**
 * The Xcode project file, from `{ objectVersion, objects, rootObject, comments }`: objects by id,
 * and the comment Xcode writes after each id that has one ("App", "Project object"...).
 */
export function pbxproj({ objectVersion, objects, rootObject, comments }) {
  const reference = (id) => (comments[id] ? `${id} /* ${comments[id]} */` : id)
  const value = (item) => (typeof item === 'string' && item in objects ? reference(item) : item)

  function render(item, depth) {
    const indent = '\t'.repeat(depth)

    if (Array.isArray(item)) {
      const lines = item.map((element) => `${indent}\t${render(element, depth + 1)},\n`)

      return `(\n${lines.join('')}${indent})`
    }
    if (typeof item === 'object') {
      const lines = sortedKeys(item).map(
        (key) => `${indent}\t${openStepString(key)} = ${render(item[key], depth + 1)};\n`,
      )

      return `{\n${lines.join('')}${indent}}`
    }

    return value(item) === item ? openStepString(String(item)) : value(item)
  }

  function renderObject(id, object) {
    if (!SINGLE_LINE_ISAS.has(object.isa)) return `\t\t${reference(id)} = ${render(object, 2)};\n`

    const entries = sortedKeys(object).map((key) => `${key} = ${render(object[key], 3)}; `)

    return `\t\t${reference(id)} = {${entries.join('')}};\n`
  }

  const isas = [...new Set(Object.values(objects).map((object) => object.isa))].sort()
  const sections = isas.map((isa) => {
    const ids = Object.keys(objects)
      .filter((id) => objects[id].isa === isa)
      .sort()

    return `/* Begin ${isa} section */\n${ids.map((id) => renderObject(id, objects[id])).join('')}/* End ${isa} section */\n`
  })

  return `// !$*UTF8*$!
{
\tarchiveVersion = 1;
\tclasses = {
\t};
\tobjectVersion = ${objectVersion};
\tobjects = {

${sections.join('\n')}\t};
\trootObject = ${reference(rootObject)};
}
`
}

/**
 * Android XML from `{ tag, attributes, children }`. Attribute names keep their prefix
 * ('android:name', 'tools:node'). One attribute stays on the element's line; more go one per line.
 */
export function xml(element) {
  return `<?xml version="1.0" encoding="utf-8"?>\n${xmlElement(element, 0)}\n`
}

function xmlElement({ tag, attributes = {}, children = [], text }, depth) {
  const indent = '    '.repeat(depth)
  const pairs = Object.entries(attributes).map(
    ([name, value]) => `${name}="${escapeXmlAttribute(value)}"`,
  )
  const opening =
    pairs.length <= 1
      ? `${indent}<${[tag, ...pairs].join(' ')}`
      : `${indent}<${tag}\n${pairs.map((pair) => `${indent}    ${pair}`).join('\n')}`

  if (text !== undefined) return `${opening}>${escapeXml(text)}</${tag}>`
  if (children.length === 0) return `${opening} />`

  const content = children.map((child) => xmlElement(child, depth + 1)).join('\n')

  return `${opening}>\n${content}\n${indent}</${tag}>`
}

/** A string resource's text: Android reads quotes, backslashes and a leading @ or ? specially. */
export function androidString(text) {
  return text
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('"', '\\"')
    .replace(/^([@?])/, '\\$1')
}
