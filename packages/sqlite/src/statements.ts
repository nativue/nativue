// Splits a script into its statements for Database.execute: Android runs one statement at a time.
// Like sqlite3_complete: a semicolon inside quotes or comments doesn't end a statement, nor one inside
// CREATE TRIGGER ... BEGIN ... END, whose statement ends at "END;".

const CLOSING_QUOTES: Record<string, string> = { "'": "'", '"': '"', '`': '`', '[': ']' }

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
    const closingQuote = CLOSING_QUOTES[character]
    const word = /^[\w$]+/.exec(sql.slice(index, index + 64))?.[0]

    if (closingQuote) {
      index = quoteEnd(sql, closingQuote, index + 1)
      lastToken = character
    } else if (sql.startsWith('--', index)) {
      index = commentEnd(sql, '\n', index)
    } else if (sql.startsWith('/*', index)) {
      index = commentEnd(sql, '*/', index)
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
