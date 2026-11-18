package dev.nativue.sqlite

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteCursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteQuery
import dev.nativue.NativuePlugin
import dev.nativue.Promise
import dev.nativue.PluginRegistry
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.abs

/** The sqlite.* functions src/index.ts calls, on the SQLite that ships with Android. */
class SQLitePlugin : NativuePlugin {
    /** The open databases, by name: one connection each, kept across JS reloads. */
    private val databasesByName = ConcurrentHashMap<String, Database>()

    override fun register(registry: PluginRegistry) {
        val context = registry.context.applicationContext
        fun database(arguments: List<Any?>): Database {
            val name = arguments[0] as String

            return databasesByName.computeIfAbsent(name) { Database(context, name) }
        }

        registry.addAsyncFunction("sqlite.query") { arguments, promise ->
            database(arguments).query(arguments[1] as String, parametersAt(arguments, 2), promise)
        }

        registry.addAsyncFunction("sqlite.iterate") { arguments, promise ->
            database(arguments).iterate(arguments[1] as String, parametersAt(arguments, 2), int(arguments[3]), promise)
        }

        registry.addAsyncFunction("sqlite.next") { arguments, promise ->
            database(arguments).next(int(arguments[1]), int(arguments[2]), promise)
        }

        registry.addAsyncFunction("sqlite.end") { arguments, promise ->
            database(arguments).end(int(arguments[1]), promise)
        }

        registry.addAsyncFunction("sqlite.batch") { arguments, promise ->
            val database = database(arguments)
            val statements = (arguments[1] as? List<*> ?: emptyList<Any?>()).map { statement ->
                val parts = statement as List<*>
                parts[0] as String to (parts.getOrNull(1) as? List<*> ?: emptyList<Any?>())
            }
            database.batch(statements, promise)
        }

        registry.addAsyncFunction("sqlite.close") { arguments, promise ->
            val database = databasesByName.remove(arguments[0] as String)
            if (database == null) promise.resolve() else database.close(promise)
        }
    }
}

private fun parametersAt(arguments: List<Any?>, index: Int) = arguments[index] as? List<*> ?: emptyList<Any?>()

private fun int(argument: Any?) = (argument as Number).toInt()

private class Database(context: Context, name: String) {
    /** One statement at a time, off the JS and main threads. */
    private val executor: ExecutorService = Executors.newSingleThreadExecutor()

    /**
     * iterate()'s open queries, read a chunk at a time; only touched on the executor.
     * Limitation: A JS reload leaves the ones it was reading open until the database closes.
     */
    private val cursorsById = mutableMapOf<Int, Cursor>()
    private var nextCursorId = 1

    // Opened on the executor with the first statement, so a failure rejects that statement. Without
    // localized collators, Android doesn't add its android_metadata table: the file is plain SQLite.
    private val connection by lazy {
        val path = if (name == ":memory:") name else context.getDatabasePath(name).also { it.parentFile?.mkdirs() }.path
        val flags = SQLiteDatabase.CREATE_IF_NECESSARY or SQLiteDatabase.NO_LOCALIZED_COLLATORS

        SQLiteDatabase.openDatabase(path, null, flags).apply {
            // As on iOS: much faster writes; losing power can undo the last commits. Through PRAGMA, not
            // enableWriteAheadLogging(), which opens more connections: changes() needs the one.
            rawQuery("PRAGMA journal_mode = WAL", null).use { it.moveToFirst() }
            execSQL("PRAGMA synchronous = NORMAL")
        }
    }

    fun query(sql: String, parameters: List<*>, promise: Promise) = settle(promise) { run(sql, parameters) }

    fun batch(statements: List<Pair<String, List<*>>>, promise: Promise) = settle(promise) { runBatch(statements) }

    // Android counts the rows before handing out the first: the query runs through once more.
    fun iterate(sql: String, parameters: List<*>, chunkSize: Int, promise: Promise) = settle(promise) {
        val cursorId = nextCursorId++
        val cursor = openCursor(sql, parameters)
        cursorsById[cursorId] = cursor

        try {
            mapOf("cursorId" to cursorId, "columns" to cursor.columnNames.toList()) + readChunk(cursorId, chunkSize)
        } catch (error: Exception) {
            cursorsById.remove(cursorId)?.close()
            throw error
        }
    }

    fun next(cursorId: Int, chunkSize: Int, promise: Promise) = settle(promise) { readChunk(cursorId, chunkSize) }

    fun end(cursorId: Int, promise: Promise) = settle(promise) {
        cursorsById.remove(cursorId)?.close()
        emptyMap()
    }

    private fun settle(promise: Promise, work: () -> Map<String, Any?>) = executor.execute {
        try {
            promise.resolve(work())
        } catch (error: Exception) {
            // Android adds " (code 1 SQLITE_ERROR): , while compiling: …" to SQLite's message
            promise.reject(error.message?.substringBefore(" (code ") ?: error.toString())
        }
    }

    fun close(promise: Promise) = executor.execute {
        cursorsById.values.forEach { it.close() }
        cursorsById.clear()
        connection.close()
        executor.shutdown()
        promise.resolve()
    }

    /** All the statements or none: a savepoint is a transaction of its own, or nests in the caller's. */
    private fun runBatch(statements: List<Pair<String, List<*>>>): Map<String, Any?> {
        val changesBefore = longQuery("SELECT total_changes()")
        run("SAVEPOINT nativue_batch", emptyList<Any?>())

        try {
            for ((sql, parameters) in statements) run(sql, parameters)
            run("RELEASE nativue_batch", emptyList<Any?>())
        } catch (error: Exception) {
            run("ROLLBACK TO nativue_batch", emptyList<Any?>())
            run("RELEASE nativue_batch", emptyList<Any?>())
            throw error
        }

        return mapOf(
            "changes" to longQuery("SELECT total_changes()") - changesBefore,
            "lastInsertId" to longQuery("SELECT last_insert_rowid()"),
        )
    }

    /**
     * `{ columns, rows, changes, lastInsertId }`, rows as lists of values in the columns' order.
     * Every statement goes through a cursor: it runs writes, BEGIN and COMMIT too, when it's read.
     */
    private fun run(sql: String, parameters: List<*>): Map<String, Any?> {
        val (columns, rows) = openCursor(sql, parameters).use { it.columnNames.toList() to readRows(it) }

        return mapOf(
            "columns" to columns,
            "rows" to rows,
            "changes" to longQuery("SELECT changes()"),
            "lastInsertId" to longQuery("SELECT last_insert_rowid()"),
        )
    }

    private fun openCursor(sql: String, parameters: List<*>): Cursor =
        connection.rawQueryWithFactory({ _, driver, editTable, query ->
            parameters.forEachIndexed { index, parameter -> bind(query, index + 1, parameter) }
            SQLiteCursor(driver, editTable, query)
        }, sql, null, "")

    /** `{ rows, done }`: the cursor closes once its last row is read. */
    private fun readChunk(cursorId: Int, chunkSize: Int): Map<String, Any?> {
        val cursor = cursorsById[cursorId] ?: throw IllegalStateException("The rows were already read")
        val rows = readRows(cursor, chunkSize)
        val done = cursor.count == 0 || cursor.position >= cursor.count - 1
        if (done) cursorsById.remove(cursorId)?.close()

        return mapOf("rows" to rows, "done" to done)
    }

    private fun readRows(cursor: Cursor, limit: Int = Int.MAX_VALUE): List<List<Any?>> {
        val rows = mutableListOf<List<Any?>>()
        while (rows.size < limit && cursor.moveToNext()) rows.add((0 until cursor.columnCount).map { value(cursor, it) })

        return rows
    }

    // Without WAL, Android keeps a single connection, so this sees the statement that just ran.
    private fun longQuery(sql: String): Long = connection.compileStatement(sql).use { it.simpleQueryForLong() }

    // JS numbers arrive as doubles: whole ones bind as integers, so `id = ?` matches an INTEGER column.
    private fun bind(query: SQLiteQuery, index: Int, parameter: Any?) {
        when (parameter) {
            is Number -> {
                val number = parameter.toDouble()
                val isInteger = Math.rint(number) == number && abs(number) < 9.2e18
                if (isInteger) query.bindLong(index, number.toLong()) else query.bindDouble(index, number)
            }
            is String -> query.bindString(index, parameter)
            is ByteArray -> query.bindBlob(index, parameter)
            else -> query.bindNull(index)
        }
    }

    private fun value(cursor: Cursor, column: Int): Any? = when (cursor.getType(column)) {
        Cursor.FIELD_TYPE_INTEGER -> cursor.getLong(column)
        Cursor.FIELD_TYPE_FLOAT -> cursor.getDouble(column)
        Cursor.FIELD_TYPE_STRING -> cursor.getString(column)
        Cursor.FIELD_TYPE_BLOB -> cursor.getBlob(column)
        else -> null
    }
}
