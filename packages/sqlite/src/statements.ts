// Reads SQL text outside quotes and comments: to split a script into statements, and to number named
// parameters.

const CLOSING_QUOTES: Record<string, string> = { "'": "'", '"': '"', '`': '`', '[': ']' }

/**
 * A script's statements, for Database.execute: Android runs one statement at a time. Like
 * sqlite3_complete: a semicolon inside quotes or comments doesn't end a statement, nor one inside
 * CREATE TRIGGER ... BEGIN ... END, whose statement ends at "END;".
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = []
  let start = 0
  let firstWords: string[] = []
  let lastToken = ''
  let index = 0

  const endStatement = (end: number) => {
    statements.push(sql.slice(start, end).trim())
    start = end + 1
    firstWords = []
    lastToken = ''
  }

  while (index < sql.length) {
    const character = sql[index]
    const skippedTo = quoteOrCommentEnd(sql, index)
    const word = wordAt(sql, index)

    if (skippedTo !== undefined) {
      if (CLOSING_QUOTES[character]) lastToken = character
      index = skippedTo
    } else if (word) {
      lastToken = word.toUpperCase()
      if (firstWords.length < 3) firstWords.push(lastToken)
      index += word.length
    } else if (character === ';' && (!isTrigger(firstWords) || lastToken === 'END')) {
      endStatement(index)
      index++
    } else {
      if (!/\s/.test(character)) lastToken = character
      index++
    }
  }
  endStatement(sql.length)

  return statements.filter(Boolean)
}

/**
 * `$name`, `:name` and `@name` placeholders as numbered ones (?1, ?2…), with their values in that
 * order: Android binds parameters by number only. A key may leave out the prefix: { title } for $title.
 */
export function numberNamedParameters<Value>(
  sql: string,
  values: Record<string, Value>,
): { sql: string; parameters: Value[] } {
  const parameters: Value[] = []
  const numbersByName = new Map<string, number>()
  let numberedSql = ''
  let index = 0

  const numberOf = (name: string) => {
    if (!numbersByName.has(name)) {
      parameters.push(valueOf(values, name))
      numbersByName.set(name, parameters.length)
    }

    return numbersByName.get(name)
  }

  while (index < sql.length) {
    const skippedTo = quoteOrCommentEnd(sql, index)
    const name = /^[$:@][A-Za-z_]\w*/.exec(sql.slice(index, index + 128))?.[0]
    // Whole words, so the $ inside an identifier like a$b isn't read as a parameter.
    const word = wordAt(sql, index)
    const end = skippedTo ?? index + (name ?? word ?? sql[index]).length

    numberedSql += name ? `?${numberOf(name)}` : sql.slice(index, end)
    index = end
  }

  return { sql: numberedSql, parameters }
}

function valueOf<Value>(values: Record<string, Value>, name: string): Value {
  if (name in values) return values[name]

  const unprefixedName = name.slice(1)
  if (unprefixedName in values) return values[unprefixedName]

  throw new Error(`No value for the parameter ${name}`)
}

function wordAt(sql: string, index: number): string | undefined {
  return /^[\w$]+/.exec(sql.slice(index, index + 128))?.[0]
}

/** Where the quote or comment starting at `index` ends; undefined if none starts there. */
function quoteOrCommentEnd(sql: string, index: number): number | undefined {
  const closingQuote = CLOSING_QUOTES[sql[index]]

  if (closingQuote) return quoteEnd(sql, closingQuote, index + 1)
  if (sql.startsWith('--', index)) return commentEnd(sql, '\n', index)
  if (sql.startsWith('/*', index)) return commentEnd(sql, '*/', index)

  return undefined
}

// A quote is escaped by doubling it ('it''s'); [identifiers] can't contain ].
function quoteEnd(sql: string, closingQuote: string, from: number): number {
  let index = from

  while (index < sql.length) {
    if (sql[index] !== closingQuote) {
      index++
    } else if (closingQuote !== ']' && sql[index + 1] === closingQuote) {
      index += 2
    } else {
      return index + 1
    }
  }

  return sql.length
}

function commentEnd(sql: string, terminator: string, from: number): number {
  const end = sql.indexOf(terminator, from + 2)

  return end === -1 ? sql.length : end + terminator.length
}

function isTrigger([first, second, third]: string[]): boolean {
  if (first !== 'CREATE') return false

  return second === 'TRIGGER' || (['TEMP', 'TEMPORARY'].includes(second) && third === 'TRIGGER')
}
