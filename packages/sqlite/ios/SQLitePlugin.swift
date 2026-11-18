import Foundation
import Nativue
import SQLite3

/// sqlite.query, sqlite.batch and sqlite.close (src/index.ts), on the SQLite that ships with iOS.
public final class SQLitePlugin: NativuePlugin {
    private let databases = Databases()

    public init() {}

    public func register(in registry: PluginRegistry) {
        registry.addAsyncFunction("sqlite.query") { [databases] arguments in
            let database = try databases.database(named: arguments[0] as? String ?? "")

            return try await database.query(arguments[1] as? String ?? "", parameters: arguments[2] as? [Any] ?? [])
        }

        registry.addAsyncFunction("sqlite.batch") { [databases] arguments in
            let database = try databases.database(named: arguments[0] as? String ?? "")
            let statements = (arguments[1] as? [[Any]] ?? []).map { statement in
                (sql: statement.first as? String ?? "", parameters: statement.dropFirst().first as? [Any] ?? [])
            }

            return try await database.batch(statements)
        }

        registry.addAsyncFunction("sqlite.close") { [databases] arguments in
            await databases.close(named: arguments[0] as? String ?? "")

            return nil
        }
    }
}

struct SQLiteError: LocalizedError {
    let errorDescription: String?
}

/// The open databases, by name: one connection each, kept across JS reloads.
private final class Databases {
    private var databasesByName: [String: Database] = [:]
    private let lock = NSLock()

    func database(named name: String) throws -> Database {
        try lock.withLock {
            if let database = databasesByName[name] { return database }

            let database = try Database(path: try Self.path(of: name))
            databasesByName[name] = database

            return database
        }
    }

    func close(named name: String) async {
        let database = lock.withLock { databasesByName.removeValue(forKey: name) }
        await database?.close()
    }

    /// In Application Support/databases, which iCloud backs up and the user doesn't see.
    private static func path(of name: String) throws -> String {
        if name == ":memory:" { return name }

        let directory = try FileManager.default
            .url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("databases")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        return directory.appendingPathComponent(name).path
    }
}

private final class Database: @unchecked Sendable {
    // SQLite copies bound text and blobs.
    private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    private var connection: OpaquePointer?
    /// One statement at a time, off the JS and main threads.
    private let queue = DispatchQueue(label: "dev.nativue.sqlite")

    init(path: String) throws {
        guard sqlite3_open(path, &connection) == SQLITE_OK else {
            let message = String(cString: sqlite3_errmsg(connection))
            sqlite3_close(connection)
            throw SQLiteError(errorDescription: message)
        }

        // A commit writes to the log without waiting for the disk to sync: much faster writes. Losing
        // power (not the app crashing) can undo the last commits, but never corrupts the database.
        sqlite3_exec(connection, "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL", nil, nil, nil)
    }

    func query(_ sql: String, parameters: [Any]) async throws -> [String: Any] {
        try await withCheckedThrowingContinuation { continuation in
            queue.async {
                continuation.resume(with: Result { try self.run(sql, parameters: parameters) })
            }
        }
    }

    /// All the statements or none: a savepoint is a transaction of its own, or nests in the caller's.
    func batch(_ statements: [(sql: String, parameters: [Any])]) async throws -> [String: Any] {
        try await withCheckedThrowingContinuation { continuation in
            queue.async {
                continuation.resume(with: Result { try self.runBatch(statements) })
            }
        }
    }

    func close() async {
        await withCheckedContinuation { continuation in
            queue.async {
                sqlite3_close(self.connection)
                self.connection = nil
                continuation.resume()
            }
        }
    }

    /// `{ columns, rows, changes, lastInsertId }`, rows as arrays of values in the columns' order.
    private func run(_ sql: String, parameters: [Any]) throws -> [String: Any] {
        guard let connection else { throw SQLiteError(errorDescription: "The database is closed") }

        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(connection, sql, -1, &statement, nil) == SQLITE_OK else { throw lastError() }
        defer { sqlite3_finalize(statement) }

        for (index, parameter) in parameters.enumerated() {
            guard bind(parameter, at: Int32(index + 1), in: statement) == SQLITE_OK else { throw lastError() }
        }

        let columnCount = sqlite3_column_count(statement)
        let columns = (0..<columnCount).map { String(cString: sqlite3_column_name(statement, $0)) }
        var rows: [[Any]] = []

        while true {
            let result = sqlite3_step(statement)
            if result == SQLITE_DONE { break }
            guard result == SQLITE_ROW else { throw lastError() }

            rows.append((0..<columnCount).map { value(at: $0, in: statement) })
        }

        return [
            "columns": columns,
            "rows": rows,
            "changes": Int(sqlite3_changes(connection)),
            "lastInsertId": sqlite3_last_insert_rowid(connection),
        ]
    }

    private func runBatch(_ statements: [(sql: String, parameters: [Any])]) throws -> [String: Any] {
        let changesBefore = sqlite3_total_changes(connection)
        _ = try run("SAVEPOINT nativue_batch", parameters: [])

        do {
            for statement in statements { _ = try run(statement.sql, parameters: statement.parameters) }
            _ = try run("RELEASE nativue_batch", parameters: [])
        } catch {
            sqlite3_exec(connection, "ROLLBACK TO nativue_batch; RELEASE nativue_batch", nil, nil, nil)
            throw error
        }

        return [
            "changes": Int(sqlite3_total_changes(connection) - changesBefore),
            "lastInsertId": sqlite3_last_insert_rowid(connection),
        ]
    }

    // JS numbers arrive as doubles: whole ones bind as integers, so `id = ?` matches an INTEGER column.
    private func bind(_ parameter: Any, at index: Int32, in statement: OpaquePointer?) -> Int32 {
        switch parameter {
        case let number as NSNumber:
            let double = number.doubleValue
            let isInteger = double.rounded() == double && abs(double) < 9.2e18
            return isInteger
                ? sqlite3_bind_int64(statement, index, Int64(double))
                : sqlite3_bind_double(statement, index, double)

        case let text as String:
            return sqlite3_bind_text(statement, index, text, -1, Self.transient)

        case let blob as [String: Any]:
            let data = Data(base64Encoded: blob["base64"] as? String ?? "") ?? Data()
            return data.withUnsafeBytes {
                sqlite3_bind_blob(statement, index, $0.baseAddress, Int32(data.count), Self.transient)
            }

        default:
            return sqlite3_bind_null(statement, index)
        }
    }

    private func value(at column: Int32, in statement: OpaquePointer?) -> Any {
        switch sqlite3_column_type(statement, column) {
        case SQLITE_INTEGER:
            return sqlite3_column_int64(statement, column)

        case SQLITE_FLOAT:
            return sqlite3_column_double(statement, column)

        case SQLITE_TEXT:
            return String(cString: sqlite3_column_text(statement, column))

        case SQLITE_BLOB:
            let size = Int(sqlite3_column_bytes(statement, column))
            let bytes = sqlite3_column_blob(statement, column)
            let data = bytes.map { Data(bytes: $0, count: size) } ?? Data()
            return ["base64": data.base64EncodedString()]

        default:
            return NSNull()
        }
    }

    private func lastError() -> SQLiteError {
        SQLiteError(errorDescription: String(cString: sqlite3_errmsg(connection)))
    }
}
