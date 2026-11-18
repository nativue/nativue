// SQLite databases, on the SQLite that ships with iOS and Android. Each database runs its statements one
// at a time, off the UI thread.
//   const db = SQLite.open('app.db')
//   await db.execute('CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY, title TEXT)')
//   await db.run('INSERT INTO todos (title) VALUES (?)', ['Buy bread'])
//   const todos = await db.all<Todo>('SELECT * FROM todos')
// Limitation: Integers beyond Number.MAX_SAFE_INTEGER lose precision; store them as TEXT.
import { requireNativeFunction } from '@nativue/core'
import { fromByteArray, toByteArray } from 'base64-js'
import { splitStatements } from './statements'

export type Value = number | string | null | Uint8Array
export type Parameter = Value | boolean | undefined | ArrayBuffer
export type Row = Record<string, Value>

export interface RunResult {
  /** Rows changed by the last INSERT, UPDATE or DELETE. */
  changes: number
  /** The rowid of the last INSERT. */
  lastInsertId: number
}

/** BLOBs cross as base64, in an object to tell them from text. */
type NativeValue = number | string | null | { base64: string }

interface NativeResult extends RunResult {
  columns: string[]
  rows: NativeValue[][]
}

const nativeQuery =
  requireNativeFunction<
    (database: string, sql: string, parameters: NativeValue[]) => Promise<NativeResult>
  >('sqlite.query')
const nativeClose = requireNativeFunction<(database: string) => Promise<void>>('sqlite.close')

/** Statements run on a database: the Database itself, or the transaction it hands to `transaction()`. */
export class Statements {
  constructor(readonly name: string) {}

  /** One or more statements, without parameters: e.g. a schema. */
  async execute(sql: string): Promise<void> {
    for (const statement of splitStatements(sql)) await this.query(statement, [])
  }

  async run(sql: string, parameters: Parameter[] = []): Promise<RunResult> {
    const { changes, lastInsertId } = await this.query(sql, parameters)

    return { changes, lastInsertId }
  }

  async all<Result = Row>(sql: string, parameters: Parameter[] = []): Promise<Result[]> {
    const { columns, rows } = await this.query(sql, parameters)

    return rows.map((row) => rowObject(columns, row) as Result)
  }

  async get<Result = Row>(sql: string, parameters: Parameter[] = []): Promise<Result | null> {
    const [first] = await this.all<Result>(sql, parameters)

    return first ?? null
  }

  /** The rows as arrays, in the columns' order: for ORMs, where joined tables share column names. */
  async values(sql: string, parameters: Parameter[] = []): Promise<Value[][]> {
    const { rows } = await this.query(sql, parameters)

    return rows.map((row) => row.map(value))
  }

  protected query(sql: string, parameters: Parameter[]): Promise<NativeResult> {
    return nativeQuery(this.name, sql, parameters.map(nativeParameter))
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

  protected override query(sql: string, parameters: Parameter[]): Promise<NativeResult> {
    return this.enqueue(() => super.query(sql, parameters))
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
