# @nativue/sqlite

SQLite databases for [nativue](https://github.com/nativue/nativue) apps, on the SQLite that ships
with iOS and Android.

```sh
npm install @nativue/sqlite
```

Then rebuild the app (`npm run ios`, `npm run android`): its native code is linked when the app is
built.

```ts
import { SQLite } from '@nativue/sqlite'

interface Todo {
  id: number
  title: string
  done: number
}

const db = SQLite.open('app.db')

await db.execute(`
  CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY, title TEXT NOT NULL, done INTEGER DEFAULT 0);
  CREATE INDEX IF NOT EXISTS todos_done ON todos (done);
`)

const { lastInsertId } = await db.run('INSERT INTO todos (title) VALUES (?)', ['Buy bread'])
const todos = await db.all<Todo>('SELECT * FROM todos WHERE done = ?', [false])
const todo = await db.get<Todo>('SELECT * FROM todos WHERE id = ?', [lastInsertId]) // or null

await db.transaction(async (transaction) => {
  await transaction.run('UPDATE todos SET done = 1 WHERE id = ?', [lastInsertId])
  await transaction.run('DELETE FROM todos WHERE done = 1')
})
```

|                                         |                                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| `SQLite.open(name)`                     | the database file `name`, created if missing; `':memory:'` for one in memory |
| `execute(sql)`                          | one or more statements, without parameters: a schema, a migration            |
| `run(sql, parameters?)`                 | `{ changes, lastInsertId }`                                                  |
| `all(sql, parameters?)`                 | the rows, as objects                                                         |
| `get(sql, parameters?)`                 | the first row, or `null`                                                     |
| `values(sql, parameters?)`              | the rows, as arrays in the columns' order: for ORMs                          |
| `transaction(async (transaction) => …)` | commits when it resolves, rolls back when it throws                          |
| `close()`                               | the next statement opens it again                                            |

- Parameters are `?` placeholders with an array, in order, or `$name`, `:name` and `@name` ones
  with an object: `db.get('SELECT * FROM todos WHERE id = $id', { id: 1 })`; a key may leave out
  the prefix. Never put values into the SQL text yourself.
- Values: numbers, strings, `null`, and `Uint8Array` for BLOBs. `true`/`false` are stored as
  `1`/`0`, `undefined` as `NULL`.
- Each database runs its statements one at a time, off the UI thread. While a transaction runs,
  other calls on the database wait for it to end: run the transaction's statements on the
  `transaction` it gives you.
- Files are kept in the app's private storage (Application Support on iOS, `databases` on Android)
  and are removed with the app.
- Integers beyond `Number.MAX_SAFE_INTEGER` lose precision: store them as text.

## Drizzle

[Drizzle ORM](https://orm.drizzle.team) works through its `sqlite-proxy` driver:

```ts
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { SQLite } from '@nativue/sqlite'

const database = SQLite.open('app.db')

export const db = drizzle(async (sql, parameters, method) => {
  if (method === 'run') {
    await database.run(sql, parameters)
    return { rows: [] }
  }

  const rows = await database.values(sql, parameters)
  return { rows: method === 'get' ? rows[0] : rows }
})
```

Queries, joins, `returning()`, and transactions (nested ones too) work as usual.

Migrations from `drizzle-kit generate` (with `dialect: 'sqlite'`) go into the bundle with
`import.meta.glob`; Drizzle's migrator for files needs `fs`, which apps don't have. This is what its
migrator for bundled migrations does:

```ts
import journal from '../drizzle/meta/_journal.json'

const files = import.meta.glob<string>('../drizzle/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
})

export async function migrate() {
  const migrations = journal.entries.map((entry) => ({
    sql: files[`../drizzle/${entry.tag}.sql`].split('--> statement-breakpoint'),
    bps: entry.breakpoints,
    folderMillis: entry.when,
    hash: '',
  }))

  // `dialect` and `session` are left out of Drizzle's types
  await (db as any).dialect.migrate(migrations, (db as any).session)
}
```

Call `migrate()` before the first query, e.g. in `src/app.ts`. The pending migrations run once,
together in a transaction.

## Kysely

[Kysely](https://kysely.dev) works with the dialect in `@nativue/sqlite/kysely`:

```ts
import { Kysely } from 'kysely'
import { SQLite } from '@nativue/sqlite'
import { NativueSqliteDialect } from '@nativue/sqlite/kysely'

export const db = new Kysely<Schema>({
  dialect: new NativueSqliteDialect(SQLite.open('app.db')),
})
```

Queries, `returning()`, `insertId`, transactions (controlled ones and savepoints too), the
`Migrator` (from `kysely/migration`, with a provider that returns your migrations) and
introspection work as usual. While a transaction runs, Kysely's other queries wait for it to end.
`stream()` isn't supported.
