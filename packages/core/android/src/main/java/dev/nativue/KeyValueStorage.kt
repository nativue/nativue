package dev.nativue

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

private const val SHARED_PREFERENCES_NAME = "dev.nativue.storage"
private const val SAVE_DELAY_MS = 50L

/**
 * Behind AsyncStorage. Every value lives in memory, so reads never touch the disk; changes are saved to
 * a SQLite table in the background, coalesced, so a burst of writes costs one transaction, and a save
 * writes only the keys that changed. Read and changed on the JS thread; saved on its own thread.
 * Limitation: Every value is kept in memory: meant for settings and small data, not large datasets.
 */
internal class KeyValueStorage(private val context: Context) {
    private val saver = Executors.newSingleThreadScheduledExecutor()
    private lateinit var database: SQLiteDatabase
    private val values: MutableMap<String, String> by lazy { load() }

    // Shared with the saver: guarded by `this`. A null value removes the key.
    private val pendingChanges = mutableMapOf<String, String?>()
    private var isClearPending = false
    private var isSaveScheduled = false

    fun value(key: String): String? = values[key]

    val keys: List<String>
        get() = values.keys.toList()

    fun setValue(key: String, value: String) {
        values[key] = value
        recordChange { pendingChanges[key] = value }
    }

    fun removeValue(key: String) {
        values.remove(key)
        recordChange { pendingChanges[key] = null }
    }

    fun removeAll() {
        values.clear()
        recordChange {
            pendingChanges.clear()
            isClearPending = true
        }
    }

    private fun load(): MutableMap<String, String> {
        val file = context.getDatabasePath("nativue-async-storage.db").also { it.parentFile?.mkdirs() }
        val flags = SQLiteDatabase.CREATE_IF_NECESSARY or SQLiteDatabase.NO_LOCALIZED_COLLATORS
        database = SQLiteDatabase.openDatabase(file.path, null, flags)
        database.enableWriteAheadLogging()
        database.execSQL("CREATE TABLE IF NOT EXISTS storage (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)")
        importSharedPreferences()

        val loaded = mutableMapOf<String, String>()
        database.rawQuery("SELECT key, value FROM storage", null).use { cursor ->
            while (cursor.moveToNext()) loaded[cursor.getString(0)] = cursor.getString(1)
        }

        return loaded
    }

    /** Before SQLite, values were saved to SharedPreferences: moved into the table once, then deleted. */
    private fun importSharedPreferences() {
        val saved = context.getSharedPreferences(SHARED_PREFERENCES_NAME, Context.MODE_PRIVATE).all
        if (saved.isEmpty()) return

        write(saved.mapValues { (_, value) -> value?.toString() }, clearingFirst = false)
        context.deleteSharedPreferences(SHARED_PREFERENCES_NAME)
    }

    private fun recordChange(change: () -> Unit) = synchronized(this) {
        change()
        if (!isSaveScheduled) {
            isSaveScheduled = true
            saver.schedule(::save, SAVE_DELAY_MS, TimeUnit.MILLISECONDS)
        }
    }

    private fun save() {
        val (changes, clearingFirst) = synchronized(this) {
            val snapshot = pendingChanges.toMap() to isClearPending
            pendingChanges.clear()
            isClearPending = false
            isSaveScheduled = false
            snapshot
        }

        write(changes, clearingFirst)
    }

    // A failed save leaves memory ahead of the disk: the next launch reads what was saved.
    private fun write(changes: Map<String, String?>, clearingFirst: Boolean) {
        database.beginTransaction()
        try {
            if (clearingFirst) database.delete("storage", null, null)

            for ((key, value) in changes) {
                if (value == null) {
                    database.delete("storage", "key = ?", arrayOf(key))
                } else {
                    val row = ContentValues().apply {
                        put("key", key)
                        put("value", value)
                    }
                    database.insertWithOnConflict("storage", null, row, SQLiteDatabase.CONFLICT_REPLACE)
                }
            }

            database.setTransactionSuccessful()
        } finally {
            database.endTransaction()
        }
    }
}
