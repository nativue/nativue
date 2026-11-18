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
| `transaction(async (transaction) => …)` | commits when it resolves, rolls back when it throws                          |
| `close()`                               | the next statement opens it again                                            |

- Parameters are `?` placeholders, in order: never put values into the SQL text yourself.
- Values: numbers, strings, `null`, and `Uint8Array` for BLOBs. `true`/`false` are stored as
  `1`/`0`, `undefined` as `NULL`.
- Each database runs its statements one at a time, off the UI thread. While a transaction runs,
  other calls on the database wait for it to end: run the transaction's statements on the
  `transaction` it gives you.
- Files are kept in the app's private storage (Application Support on iOS, `databases` on Android)
  and are removed with the app.
- Integers beyond `Number.MAX_SAFE_INTEGER` lose precision: store them as text.
