package dev.nativue.sqlite

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteCursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteQuery
import android.util.Base64
import dev.nativue.NativuePlugin
import dev.nativue.Promise
import dev.nativue.PluginRegistry
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.abs

/** sqlite.query and sqlite.close (src/index.ts), on the SQLite that ships with Android. */
class SQLitePlugin : NativuePlugin {
    /** The open databases, by name: one connection each, kept across JS reloads. */
    private val databasesByName = ConcurrentHashMap<String, Database>()

    override fun register(registry: PluginRegistry) {
        val context = registry.context.applicationContext

        registry.addAsyncFunction("sqlite.query") { arguments, promise ->
            val name = arguments[0] as String
            val database = databasesByName.computeIfAbsent(name) { Database(context, name) }
            database.query(arguments[1] as String, arguments[2] as? List<*> ?: emptyList<Any?>(), promise)
        }

        registry.addAsyncFunction("sqlite.close") { arguments, promise ->
            val database = databasesByName.remove(arguments[0] as String)
            if (database == null) promise.resolve() else database.close(promise)
        }
    }
}

private class Database(context: Context, name: String) {
    /** One statement at a time, off the JS and main threads. */
    private val executor: ExecutorService = Executors.newSingleThreadExecutor()

    // Opened on the executor with the first statement, so a failure rejects that statement.
    private val connection by lazy {
        if (name == ":memory:") SQLiteDatabase.create(null)
        else SQLiteDatabase.openOrCreateDatabase(context.getDatabasePath(name).also { it.parentFile?.mkdirs() }, null)
    }

    fun query(sql: String, parameters: List<*>, promise: Promise) = executor.execute {
        try {
            promise.resolve(run(sql, parameters))
        } catch (error: Exception) {
            // Android adds " (code 1 SQLITE_ERROR): , while compiling: …" to SQLite's message
            promise.reject(error.message?.substringBefore(" (code ") ?: error.toString())
        }
    }

    fun close(promise: Promise) = executor.execute {
        connection.close()
        executor.shutdown()
        promise.resolve()
    }

    /**
     * `{ columns, rows, changes, lastInsertId }`, rows as lists of values in the columns' order.
     * Every statement goes through a cursor: it runs writes, BEGIN and COMMIT too, when it's read.
     */
    private fun run(sql: String, parameters: List<*>): Map<String, Any?> {
        val cursor = connection.rawQueryWithFactory({ _, driver, editTable, query ->
            parameters.forEachIndexed { index, parameter -> bind(query, index + 1, parameter) }
            SQLiteCursor(driver, editTable, query)
        }, sql, null, "")

        val (columns, rows) = cursor.use { it.columnNames.toList() to readRows(it) }

        return mapOf(
            "columns" to columns,
            "rows" to rows,
            "changes" to longQuery("SELECT changes()"),
            "lastInsertId" to longQuery("SELECT last_insert_rowid()"),
        )
    }

    private fun readRows(cursor: Cursor): List<List<Any?>> {
        val rows = mutableListOf<List<Any?>>()
        while (cursor.moveToNext()) rows.add((0 until cursor.columnCount).map { value(cursor, it) })

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
            is Map<*, *> -> query.bindBlob(index, Base64.decode(parameter["base64"] as? String ?: "", Base64.NO_WRAP))
            else -> query.bindNull(index)
        }
    }

    private fun value(cursor: Cursor, column: Int): Any? = when (cursor.getType(column)) {
        Cursor.FIELD_TYPE_INTEGER -> cursor.getLong(column)
        Cursor.FIELD_TYPE_FLOAT -> cursor.getDouble(column)
        Cursor.FIELD_TYPE_STRING -> cursor.getString(column)
        Cursor.FIELD_TYPE_BLOB -> mapOf("base64" to Base64.encodeToString(cursor.getBlob(column), Base64.NO_WRAP))
        else -> null
    }
}
