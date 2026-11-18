// A Kysely dialect on a @nativue/sqlite database:
//   const db = new Kysely<Schema>({ dialect: new NativueSqliteDialect(SQLite.open('app.db')) })
import {
  CompiledQuery,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type Kysely,
  type QueryResult,
} from 'kysely'
import type { Database, Parameter } from './index'

export class NativueSqliteDialect implements Dialect {
  constructor(private readonly database: Database) {}

  createAdapter() {
    return new SqliteAdapter()
  }

  createDriver() {
    return new NativueSqliteDriver(this.database)
  }

  createIntrospector(db: Kysely<unknown>) {
    return new SqliteIntrospector(db)
  }

  createQueryCompiler() {
    return new SqliteQueryCompiler()
  }
}

class NativueSqliteConnection implements DatabaseConnection {
  constructor(private readonly database: Database) {}

  async executeQuery<Row>({ sql, parameters, query }: CompiledQuery): Promise<QueryResult<Row>> {
    const values = parameters as Parameter[]
    const returnsRows =
      query.kind === 'SelectQueryNode' ||
      query.kind === 'RawNode' ||
      ('returning' in query && query.returning !== undefined)

    if (returnsRows) return { rows: await this.database.all<Row>(sql, values) }

    const { changes, lastInsertId } = await this.database.run(sql, values)

    return { rows: [], numAffectedRows: BigInt(changes), insertId: BigInt(lastInsertId) }
  }

  // Limitation: No streaming; select in pages with limit and offset.
  async *streamQuery<Row>(): AsyncIterableIterator<QueryResult<Row>> {
    throw new Error('@nativue/sqlite does not stream query results')
  }
}

/** One connection, lent to one caller at a time: nothing else runs inside a transaction. */
class NativueSqliteDriver implements Driver {
  private readonly connection: NativueSqliteConnection
  private lock: Promise<void> = Promise.resolve()
  private unlock = () => {}

  constructor(private readonly database: Database) {
    this.connection = new NativueSqliteConnection(database)
  }

  async init() {}

  async acquireConnection() {
    const previous = this.lock
    this.lock = new Promise((resolve) => (this.unlock = resolve))
    await previous

    return this.connection
  }

  async releaseConnection() {
    this.unlock()
  }

  async beginTransaction(connection: DatabaseConnection) {
    await run(connection, 'begin')
  }

  async commitTransaction(connection: DatabaseConnection) {
    await run(connection, 'commit')
  }

  async rollbackTransaction(connection: DatabaseConnection) {
    await run(connection, 'rollback')
  }

  async savepoint(connection: DatabaseConnection, name: string) {
    await run(connection, `savepoint ${name}`)
  }

  async rollbackToSavepoint(connection: DatabaseConnection, name: string) {
    await run(connection, `rollback to ${name}`)
  }

  async releaseSavepoint(connection: DatabaseConnection, name: string) {
    await run(connection, `release ${name}`)
  }

  async destroy() {
    await this.database.close()
  }
}

function run(connection: DatabaseConnection, sql: string) {
  return connection.executeQuery(CompiledQuery.raw(sql))
}
