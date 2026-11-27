// console as on the web, for engines without one: values formatted as Node and browsers do, %
// substitutions, table, group and assert. The rest of the web's console does nothing, so libraries
// calling it keep working.

export type LogLevel = 'log' | 'info' | 'debug' | 'warn' | 'error'

/** How deep nested objects show; deeper ones read [Object] and [Array], as in Node. */
const MAX_DEPTH = 2
/** An object or array longer than this on one line shows one entry per line. */
const MAX_LINE_LENGTH = 72
const INDENT = '  '
const SUBSTITUTION = /%[sdifoOc%]/g

export function createConsole(write: (level: LogLevel, text: string) => void) {
  let groupDepth = 0

  function emit(level: LogLevel, text: string) {
    write(level, text.replace(/^/gm, INDENT.repeat(groupDepth)))
  }

  const printer =
    (level: LogLevel) =>
    (...values: unknown[]) =>
      emit(level, formatValues(values))

  function group(...labels: unknown[]) {
    if (labels.length > 0) emit('log', formatValues(labels))
    groupDepth++
  }

  const doNothing = () => {}

  return {
    log: printer('log'),
    info: printer('info'),
    debug: printer('debug'),
    warn: printer('warn'),
    error: printer('error'),

    trace(...values: unknown[]) {
      // The stack's first lines are the Error's and this function's frame.
      const stack = (new Error().stack ?? '').split('\n').slice(2).join('\n')

      emit('log', `Trace: ${formatValues(values)}\n${stack}`)
    },

    table(data: unknown, columns?: string[]) {
      if (typeof data !== 'object' || data === null) return emit('log', formatValues([data]))

      emit('log', formatTable(data, columns))
    },

    group,
    // A terminal can't fold a group: it shows open.
    groupCollapsed: group,

    groupEnd() {
      groupDepth = Math.max(0, groupDepth - 1)
    },

    assert(condition?: unknown, ...values: unknown[]) {
      if (condition) return

      emit(
        'error',
        values.length > 0 ? `Assertion failed: ${formatValues(values)}` : 'Assertion failed',
      )
    },

    clear: doNothing,
    count: doNothing,
    countReset: doNothing,
    dir: doNothing,
    dirxml: doNothing,
    profile: doNothing,
    profileEnd: doNothing,
    time: doNothing,
    timeEnd: doNothing,
    timeLog: doNothing,
    timeStamp: doNothing,
  }
}

/** Strings as they are, the rest inspected; a first string with % takes the next values in. */
export function formatValues(values: unknown[]): string {
  const [first, ...rest] = values
  if (typeof first !== 'string' || !first.includes('%')) return values.map(formatValue).join(' ')

  const remaining = [...rest]
  const substituted = first.replace(SUBSTITUTION, (token) => {
    if (token === '%%') return '%'
    if (remaining.length === 0) return token

    return substitute(token, remaining.shift())
  })

  return [substituted, ...remaining.map(formatValue)].join(' ')
}

function substitute(token: string, value: unknown) {
  switch (token) {
    case '%s':
      return formatValue(value)
    case '%d':
      return String(typeof value === 'object' ? NaN : Number(value))
    case '%i':
      return String(parseInt(String(value), 10))
    case '%f':
      return String(parseFloat(String(value)))
    case '%c':
      return '' // CSS, which a terminal can't apply
    default:
      return inspect(value)
  }
}

function formatValue(value: unknown) {
  return typeof value === 'string' ? value : inspect(value)
}

export function inspect(value: unknown, depth = 0, seen = new Set<object>()): string {
  switch (typeof value) {
    case 'string':
      return `'${value.replaceAll("'", "\\'")}'`
    case 'bigint':
      return `${value}n`
    case 'symbol':
      return value.toString()
    case 'function':
      return `[Function: ${value.name || '(anonymous)'}]`
    case 'object':
      return value === null ? 'null' : inspectObject(value, depth, seen)
    default:
      return String(value)
  }
}

function inspectObject(value: object, depth: number, seen: Set<object>): string {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`
  if (value instanceof Date) return isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString()
  if (value instanceof RegExp) return String(value)
  if (seen.has(value)) return '[Circular]'
  if (depth > MAX_DEPTH) return Array.isArray(value) ? '[Array]' : '[Object]'

  seen.add(value)
  try {
    const inspectNested = (nested: unknown) => inspect(nested, depth + 1, seen)

    if (Array.isArray(value)) return wrap('[', value.map(inspectNested), ']')
    if (value instanceof Map) {
      const entries = [...value].map(
        ([key, item]) => `${inspectNested(key)} => ${inspectNested(item)}`,
      )

      return wrap(`Map(${value.size}) {`, entries, '}')
    }
    if (value instanceof Set)
      return wrap(`Set(${value.size}) {`, [...value].map(inspectNested), '}')

    const entries = Object.entries(value).map(
      ([key, item]) => `${formatKey(key)}: ${inspectNested(item)}`,
    )

    return wrap(`${className(value)}{`, entries, '}')
  } finally {
    seen.delete(value)
  }
}

/** 'Point ' for a class's instance, nothing for a plain object. */
function className(value: object) {
  const name = Object.getPrototypeOf(value)?.constructor?.name

  return name && name !== 'Object' ? `${name} ` : ''
}

function formatKey(key: string) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : inspect(key)
}

function wrap(open: string, entries: string[], close: string) {
  if (entries.length === 0) return `${open}${close}`

  const oneLine = `${open} ${entries.join(', ')} ${close}`
  if (oneLine.length <= MAX_LINE_LENGTH && !oneLine.includes('\n')) return oneLine

  return `${open}\n${entries.map((entry) => entry.replace(/^/gm, INDENT)).join(',\n')}\n${close}`
}

/** A row per entry, a column per key of the entries that are objects, and Values for the others. */
export function formatTable(data: object, columns?: string[]) {
  const rows = data instanceof Map ? [...data] : Object.entries(data)
  const keys = columns ?? [
    ...new Set(rows.flatMap(([, row]) => (isTableRow(row) ? Object.keys(row) : []))),
  ]
  const hasValues = rows.some(([, row]) => !isTableRow(row))
  const header = ['(index)', ...keys, ...(hasValues ? ['Values'] : [])]
  const body = rows.map(([index, row]) => [
    String(index),
    ...keys.map((key) => (isTableRow(row) && key in row ? inspect(row[key], MAX_DEPTH) : '')),
    ...(hasValues ? [isTableRow(row) ? '' : inspect(row, MAX_DEPTH)] : []),
  ])
  const widths = header.map((title, column) =>
    Math.max(title.length, ...body.map((cells) => cells[column].length)),
  )
  const line = (left: string, middle: string, right: string) =>
    left + widths.map((width) => '─'.repeat(width + 2)).join(middle) + right
  const row = (cells: string[]) =>
    `│ ${cells.map((cell, column) => cell.padEnd(widths[column])).join(' │ ')} │`

  return [
    line('┌', '┬', '┐'),
    row(header),
    line('├', '┼', '┤'),
    ...body.map(row),
    line('└', '┴', '┘'),
  ].join('\n')
}

function isTableRow(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
