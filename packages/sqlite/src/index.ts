// SQLite databases, on the SQLite that ships with iOS and Android. Each database runs its statements one
// at a time, off the UI thread.
//   const db = SQLite.open('app.db')
//   await db.execute('CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY, title TEXT)')
//   await db.run('INSERT INTO todos (title) VALUES (?)', ['Buy bread'])
//   const todos = await db.all<Todo>('SELECT * FROM todos')
// Limitation: Integers beyond Number.MAX_SAFE_INTEGER lose precision; store them as TEXT.
import { requireNativeFunction } from '@nativue/core'
import { fromByteArray, toByteArray } from 'base64-js'
import { numberNamedParameters, splitStatements } from './statements'

export type Value = number | string | null | Uint8Array
export type Parameter = Value | boolean | undefined | ArrayBuffer
export type Row = Record<string, Value>
/** In order for `?`; by name for `$name`, `:name` and `@name`, with or without the prefix. */
export type QueryParameters = Parameter[] | Record<string, Parameter>

export interface RunResult {
  /** Rows changed by the last INSERT, UPDATE or DELETE. */
  changes: number
  /** The rowid of the last INSERT. */
  lastInsertId: number
}

/** A statement and its parameters, for `batch()`. */
export type BatchStatement = [sql: string, parameters?: QueryParameters]

/** BLOBs cross as base64, in an object to tell them from text. */
type NativeValue = number | string | null | { base64: string }

interface NativeResult extends RunResult {
  columns: string[]
  rows: NativeValue[][]
}

interface NativeChunk {
  rows: NativeValue[][]
  /** No rows left: the native side has closed the cursor. */
  done: boolean
}

interface NativeFirstChunk extends NativeChunk {
  cursorId: number
  columns: string[]
}

const nativeQuery =
  requireNativeFunction<
    (database: string, sql: string, parameters: NativeValue[]) => Promise<NativeResult>
  >('sqlite.query')
const nativeBatch =
  requireNativeFunction<
    (database: string, statements: [string, NativeValue[]][]) => Promise<RunResult>
  >('sqlite.batch')
const nativeIterate =
  requireNativeFunction<
    (
      database: string,
      sql: string,
      parameters: NativeValue[],
      chunkSize: number,
    ) => Promise<NativeFirstChunk>
  >('sqlite.iterate')
const nativeNext =
  requireNativeFunction<
    (database: string, cursorId: number, chunkSize: number) => Promise<NativeChunk>
  >('sqlite.next')
const nativeEnd =
  requireNativeFunction<(database: string, cursorId: number) => Promise<void>>('sqlite.end')
const nativeClose = requireNativeFunction<(database: string) => Promise<void>>('sqlite.close')

/** Statements run on a database: the Database itself, or the transaction it hands to `transaction()`. */
export class Statements {
  constructor(readonly name: string) {}

  /** One or more statements, without parameters: e.g. a schema. */
  async execute(sql: string): Promise<void> {
    for (const statement of splitStatements(sql)) await this.query(statement, [])
  }

  async run(sql: string, parameters: QueryParameters = []): Promise<RunResult> {
    const { changes, lastInsertId } = await this.query(sql, parameters)

    return { changes, lastInsertId }
  }

  async all<Result = Row>(sql: string, parameters: QueryParameters = []): Promise<Result[]> {
    const { columns, rows } = await this.query(sql, parameters)

    return rows.map((row) => rowObject(columns, row) as Result)
  }

  async get<Result = Row>(sql: string, parameters: QueryParameters = []): Promise<Result | null> {
    const [first] = await this.all<Result>(sql, parameters)

    return first ?? null
  }

  /** The rows as arrays, in the columns' order: for ORMs, where joined tables share column names. */
  async values(sql: string, parameters: QueryParameters = []): Promise<Value[][]> {
    const { rows } = await this.query(sql, parameters)

    return rows.map((row) => row.map(value))
  }

  /**
   * The rows in chunks of `chunkSize`, read as the loop asks for them: for results too large to hold at
   * once. Breaking out of the loop closes the query.
   *   for await (const todos of db.iterate<Todo>('SELECT * FROM todos')) …
   */
  async *iterate<Result = Row>(
    sql: string,
    parameters: QueryParameters = [],
    chunkSize = 100,
  ): AsyncGenerator<Result[], void, undefined> {
    const [numberedSql, values] = nativeStatement(sql, parameters)
    const first = await this.send(() => nativeIterate(this.name, numberedSql, values, chunkSize))
    let chunk: NativeChunk = first

    try {
      while (true) {
        if (chunk.rows.length > 0)
          yield chunk.rows.map((row) => rowObject(first.columns, row) as Result)
        if (chunk.done) return

        chunk = await this.send(() => nativeNext(this.name, first.cursorId, chunkSize))
      }
    } finally {
      if (!chunk.done) await this.send(() => nativeEnd(this.name, first.cursorId))
    }
  }

  /**
   * The statements in one native call, all or none: much faster than awaiting each one. `changes` counts
   * every statement's rows.
   */
  async batch(statements: BatchStatement[]): Promise<RunResult> {
    const nativeStatements = statements.map(([sql, parameters = []]) =>
      nativeStatement(sql, parameters),
    )

    return this.send(() => nativeBatch(this.name, nativeStatements))
  }

  protected query(sql: string, parameters: QueryParameters): Promise<NativeResult> {
    const [numberedSql, values] = nativeStatement(sql, parameters)

    return this.send(() => nativeQuery(this.name, numberedSql, values))
  }

  /** Hands work to the native side: right away here, in turn on a Database. */
  protected send<Result>(work: () => Promise<Result>): Promise<Result> {
    return work()
  }
}

export class Database extends Statements {
  // One call at a time, so nothing else runs inside a transaction.
  private queue: Promise<unknown> = Promise.resolve()

  /**
   * Runs `work` in a transaction: committed when it resolves, rolled back when it throws. Run its
   * statements on `transaction`; calls on the database wait for it to end.
   */
  transaction<Result>(work: (transaction: Statements) => Promise<Result>): Promise<Result> {
    return this.enqueue(async () => {
      const transaction = new Statements(this.name)
      await transaction.run('BEGIN')

      try {
        const result = await work(transaction)
        await transaction.run('COMMIT')

        return result
      } catch (error) {
        await transaction.run('ROLLBACK').catch(() => {}) // SQLite may have rolled back already
        throw error
      }
    })
  }

  close(): Promise<void> {
    return this.enqueue(() => nativeClose(this.name))
  }

  protected override send<Result>(work: () => Promise<Result>): Promise<Result> {
    return this.enqueue(work)
  }

  private enqueue<Result>(work: () => Promise<Result>): Promise<Result> {
    const result = this.queue.then(work)
    this.queue = result.catch(() => {})

    return result
  }
}

export const SQLite = {
  /**
   * The database file `name`, created if missing, in the app's private storage; ':memory:' for one
   * that lives until it's closed. It opens with its first statement.
   */
  open(name: string): Database {
    return new Database(name)
  },
}

function nativeStatement(sql: string, parameters: QueryParameters): [string, NativeValue[]] {
  if (Array.isArray(parameters)) return [sql, parameters.map(nativeParameter)]

  const numbered = numberNamedParameters(sql, parameters)

  return [numbered.sql, numbered.parameters.map(nativeParameter)]
}

function nativeParameter(parameter: Parameter): NativeValue {
  if (parameter === undefined) return null
  if (typeof parameter === 'boolean') return Number(parameter)
  if (parameter instanceof ArrayBuffer) return { base64: fromByteArray(new Uint8Array(parameter)) }
  if (parameter instanceof Uint8Array) return { base64: fromByteArray(parameter) }

  return parameter
}

function rowObject(columns: string[], values: NativeValue[]): Row {
  const row: Row = {}
  columns.forEach((column, index) => (row[column] = value(values[index])))

  return row
}

function value(nativeValue: NativeValue): Value {
  if (nativeValue !== null && typeof nativeValue === 'object')
    return toByteArray(nativeValue.base64)

  return nativeValue
}
