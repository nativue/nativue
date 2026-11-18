import Foundation
import Nativue
import SQLite3

/// The sqlite.* functions src/index.ts calls, on the SQLite that ships with iOS.
public final class SQLitePlugin: NativuePlugin {
    private let databases = Databases()

    public init() {}

    public func register(in registry: PluginRegistry) {
        registry.addAsyncFunction("sqlite.query") { [databases] arguments in
            let database = try databases.database(named: arguments[0] as? String ?? "")

            return try await database.query(arguments[1] as? String ?? "", parameters: arguments[2] as? [Any] ?? [])
        }

        registry.addAsyncFunction("sqlite.iterate") { [databases] arguments in
            let database = try databases.database(named: arguments[0] as? String ?? "")
            let sql = arguments[1] as? String ?? ""

            return try await database.iterate(sql, parameters: arguments[2] as? [Any] ?? [], chunkSize: int(arguments[3]))
        }

        registry.addAsyncFunction("sqlite.next") { [databases] arguments in
            let database = try databases.database(named: arguments[0] as? String ?? "")

            return try await database.next(cursorId: int(arguments[1]), chunkSize: int(arguments[2]))
        }

        registry.addAsyncFunction("sqlite.end") { [databases] arguments in
            let database = try databases.database(named: arguments[0] as? String ?? "")
            await database.end(cursorId: int(arguments[1]))

            return nil
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

private func int(_ argument: Any?) -> Int {
    (argument as? NSNumber)?.intValue ?? 0
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
    /// iterate()'s open statements, read a chunk at a time; only touched on the queue.
    /// Limitation: A JS reload leaves the ones it was reading open until the database closes.
    private var cursorsById: [Int: OpaquePointer] = [:]
    private var nextCursorId = 1

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
        try await onQueue { try self.run(sql, parameters: parameters) }
    }

    /// All the statements or none: a savepoint is a transaction of its own, or nests in the caller's.
    func batch(_ statements: [(sql: String, parameters: [Any])]) async throws -> [String: Any] {
        try await onQueue { try self.runBatch(statements) }
    }

    /// `{ cursorId, columns, rows, done }`: the first chunk of rows; next() reads the others.
    func iterate(_ sql: String, parameters: [Any], chunkSize: Int) async throws -> [String: Any] {
        try await onQueue {
            let statement = try self.prepare(sql, parameters: parameters)
            let columns = self.columnNames(statement) // readChunk finalizes a statement it reads to the end
            let cursorId = self.nextCursorId
            self.nextCursorId += 1
            self.cursorsById[cursorId] = statement

            let chunk = try self.readChunk(cursorId: cursorId, chunkSize: chunkSize)

            return chunk.merging(["cursorId": cursorId, "columns": columns]) { current, _ in current }
        }
    }

    func next(cursorId: Int, chunkSize: Int) async throws -> [String: Any] {
        try await onQueue { try self.readChunk(cursorId: cursorId, chunkSize: chunkSize) }
    }

    func end(cursorId: Int) async {
        _ = try? await onQueue { self.finalizeCursor(cursorId) }
    }

    func close() async {
        await withCheckedContinuation { continuation in
            queue.async {
                self.cursorsById.keys.forEach(self.finalizeCursor)
                sqlite3_close(self.connection)
                self.connection = nil
                continuation.resume()
            }
        }
    }

    private func onQueue<Result>(_ work: @escaping () throws -> Result) async throws -> Result {
        try await withCheckedThrowingContinuation { continuation in
            queue.async { continuation.resume(with: Swift.Result { try work() }) }
        }
    }

    /// `{ columns, rows, changes, lastInsertId }`, rows as arrays of values in the columns' order.
    private func run(_ sql: String, parameters: [Any]) throws -> [String: Any] {
        let statement = try prepare(sql, parameters: parameters)
        defer { sqlite3_finalize(statement) }

        let (rows, _) = try readRows(statement, limit: .max)

        return [
            "columns": columnNames(statement),
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

    private func prepare(_ sql: String, parameters: [Any]) throws -> OpaquePointer? {
        guard let connection else { throw SQLiteError(errorDescription: "The database is closed") }

        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(connection, sql, -1, &statement, nil) == SQLITE_OK else { throw lastError() }

        for (index, parameter) in parameters.enumerated() {
            guard bind(parameter, at: Int32(index + 1), in: statement) == SQLITE_OK else {
                let error = lastError()
                sqlite3_finalize(statement)
                throw error
            }
        }

        return statement
    }

    private func columnNames(_ statement: OpaquePointer?) -> [String] {
        (0..<sqlite3_column_count(statement)).map { String(cString: sqlite3_column_name(statement, $0)) }
    }

    /// Up to `limit` rows; done when the statement has none left.
    private func readRows(_ statement: OpaquePointer?, limit: Int) throws -> (rows: [[Any]], done: Bool) {
        let columnCount = sqlite3_column_count(statement)
        var rows: [[Any]] = []

        while rows.count < limit {
            let result = sqlite3_step(statement)
            if result == SQLITE_DONE { return (rows, true) }
            guard result == SQLITE_ROW else { throw lastError() }

            rows.append((0..<columnCount).map { value(at: $0, in: statement) })
        }

        return (rows, false)
    }

    /// `{ rows, done }`: the statement is finalized once it's done or fails.
    private func readChunk(cursorId: Int, chunkSize: Int) throws -> [String: Any] {
        guard let statement = cursorsById[cursorId] else { throw SQLiteError(errorDescription: "The rows were already read") }

        do {
            let (rows, done) = try readRows(statement, limit: chunkSize)
            if done { finalizeCursor(cursorId) }

            return ["rows": rows, "done": done]
        } catch {
            finalizeCursor(cursorId)
            throw error
        }
    }

    private func finalizeCursor(_ cursorId: Int) {
        sqlite3_finalize(cursorsById.removeValue(forKey: cursorId))
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

        // Empty bytes have no address, which SQLite would bind as NULL.
        case let data as Data where data.isEmpty:
            return sqlite3_bind_zeroblob(statement, index, 0)

        case let data as Data:
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
            return bytes.map { Data(bytes: $0, count: size) } ?? Data()

        default:
            return NSNull()
        }
    }

    private func lastError() -> SQLiteError {
        SQLiteError(errorDescription: String(cString: sqlite3_errmsg(connection)))
    }
}
