import Foundation
import SQLite3

/// Behind AsyncStorage. Every value lives in memory, so reads never touch the disk; changes are saved to
/// a SQLite table in the background, coalesced, so a burst of writes costs one transaction, and a save
/// writes only the keys that changed. Used only on the JS queue; the database, on the save queue once
/// loaded.
/// Limitation: Every value is kept in memory: meant for settings and small data, not large datasets.
final class KeyValueStorage {
    /// SQLite copies bound text.
    private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    private let javaScriptQueue: DispatchQueue
    private let saveQueue = DispatchQueue(label: "dev.nativue.storage", qos: .utility)
    private let directory: URL
    private var database: OpaquePointer?
    private lazy var values: [String: String] = load()
    /// Changed keys since the last save: a nil value removes the key.
    private var pendingChanges: [String: String?] = [:]
    private var isClearPending = false
    private var isSaveScheduled = false

    init(javaScriptQueue: DispatchQueue) {
        self.javaScriptQueue = javaScriptQueue

        directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    func value(forKey key: String) -> String? {
        values[key]
    }

    var keys: [String] {
        Array(values.keys)
    }

    func setValue(_ value: String, forKey key: String) {
        values[key] = value
        pendingChanges[key] = .some(value)
        scheduleSave()
    }

    func removeValue(forKey key: String) {
        values[key] = nil
        pendingChanges[key] = .some(nil)
        scheduleSave()
    }

    func removeAll() {
        values = [:]
        pendingChanges = [:]
        isClearPending = true
        scheduleSave()
    }

    private func load() -> [String: String] {
        let path = directory.appendingPathComponent("async-storage.db").path
        guard sqlite3_open(path, &database) == SQLITE_OK else { return [:] }

        execute("PRAGMA journal_mode = WAL")
        execute("CREATE TABLE IF NOT EXISTS storage (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)")
        importJSONFile()

        var loaded: [String: String] = [:]
        forEachRow("SELECT key, value FROM storage") { statement in
            loaded[String(cString: sqlite3_column_text(statement, 0))] = String(cString: sqlite3_column_text(statement, 1))
        }

        return loaded
    }

    /// Before SQLite, values were saved to a JSON file: moved into the table once, then deleted.
    private func importJSONFile() {
        let fileURL = directory.appendingPathComponent("async-storage.json")
        guard let data = try? Data(contentsOf: fileURL),
              let saved = try? JSONDecoder().decode([String: String].self, from: data)
        else { return }

        write(saved.mapValues { .some($0) }, clearingFirst: false)
        try? FileManager.default.removeItem(at: fileURL)
    }

    private func scheduleSave() {
        guard !isSaveScheduled else { return }

        isSaveScheduled = true
        javaScriptQueue.asyncAfter(deadline: .now() + .milliseconds(50)) { [self] in
            isSaveScheduled = false
            let (changes, clearingFirst) = (pendingChanges, isClearPending)
            pendingChanges = [:]
            isClearPending = false

            saveQueue.async { [self] in write(changes, clearingFirst: clearingFirst) }
        }
    }

    private func write(_ changes: [String: String?], clearingFirst: Bool) {
        execute("BEGIN")
        if clearingFirst { execute("DELETE FROM storage") }

        for (key, value) in changes {
            if let value {
                execute("INSERT OR REPLACE INTO storage (key, value) VALUES (?, ?)", key, value)
            } else {
                execute("DELETE FROM storage WHERE key = ?", key)
            }
        }

        execute("COMMIT")
    }

    // A failed save leaves memory ahead of the disk: the next launch reads what was saved.
    private func execute(_ sql: String, _ parameters: String...) {
        forEachRow(sql, parameters) { _ in }
    }

    private func forEachRow(_ sql: String, _ parameters: [String] = [], _ readRow: (OpaquePointer?) -> Void) {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK else { return }
        defer { sqlite3_finalize(statement) }

        for (index, parameter) in parameters.enumerated() {
            sqlite3_bind_text(statement, Int32(index + 1), parameter, -1, Self.transient)
        }

        while sqlite3_step(statement) == SQLITE_ROW { readRow(statement) }
    }
}
