import Foundation
import Nativue

/// FileSystem (src/index.ts): files under file:// URIs, and downloads and uploads that report their progress
/// as fileSystem.progress.
public final class FileSystemPlugin: NativuePlugin {
    private let transfers = Transfers()

    public init() {}

    public func register(in registry: PluginRegistry) {
        // The transfers of a runtime a reload replaced have no one left to answer.
        transfers.attach(to: registry)

        registry.addFunction("fileSystem.paths") { _ in
            let fileManager = FileManager.default

            return [
                "document": fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0].absoluteString,
                "cache": fileManager.urls(for: .cachesDirectory, in: .userDomainMask)[0].absoluteString,
            ]
        }

        registry.addAsyncFunction("fileSystem.readText") { arguments in
            try fileOperation {
                let data = try Data(contentsOf: fileURL(arguments[0]))

                guard let text = String(data: data, encoding: .utf8) else {
                    throw PluginError(code: "ERR_INVALID_ARGUMENT", message: "The file isn't UTF-8 text: read it as base64")
                }

                return text
            }
        }

        registry.addAsyncFunction("fileSystem.readBase64") { arguments in
            try fileOperation { try Data(contentsOf: fileURL(arguments[0])).base64EncodedString() }
        }

        registry.addAsyncFunction("fileSystem.writeText") { arguments in
            try fileOperation {
                try write(Data((arguments[1] as! String).utf8), to: fileURL(arguments[0]), append: arguments[2] as! Bool)
            }
        }

        registry.addAsyncFunction("fileSystem.writeBase64") { arguments in
            try fileOperation {
                guard let data = Data(base64Encoded: arguments[1] as! String) else {
                    throw PluginError(code: "ERR_INVALID_ARGUMENT", message: "That isn't base64")
                }

                return try write(data, to: fileURL(arguments[0]), append: arguments[2] as! Bool)
            }
        }

        registry.addAsyncFunction("fileSystem.getInfo") { arguments in
            try fileOperation { info(of: try fileURL(arguments[0])) }
        }

        registry.addAsyncFunction("fileSystem.delete") { arguments in
            try fileOperation {
                let url = try fileURL(arguments[0])

                guard FileManager.default.fileExists(atPath: url.path) else { return nil }

                try FileManager.default.removeItem(at: url)

                return nil
            }
        }

        registry.addAsyncFunction("fileSystem.makeDirectory") { arguments in
            try fileOperation {
                try FileManager.default.createDirectory(at: fileURL(arguments[0]), withIntermediateDirectories: true)

                return nil
            }
        }

        registry.addAsyncFunction("fileSystem.list") { arguments in
            try fileOperation { try FileManager.default.contentsOfDirectory(atPath: fileURL(arguments[0]).path).sorted() }
        }

        registry.addAsyncFunction("fileSystem.copy") { arguments in
            try fileOperation {
                let (source, destination) = (try fileURL(arguments[0]), try fileURL(arguments[1]))

                try prepare(destination)
                try FileManager.default.copyItem(at: source, to: destination)

                return nil
            }
        }

        registry.addAsyncFunction("fileSystem.move") { arguments in
            try fileOperation {
                let (source, destination) = (try fileURL(arguments[0]), try fileURL(arguments[1]))

                try prepare(destination)
                try FileManager.default.moveItem(at: source, to: destination)

                return nil
            }
        }

        registry.addAsyncFunction("fileSystem.download") { [transfers] arguments in
            var request = URLRequest(url: try webURL(arguments[1]))

            setHeaders(arguments[3], on: &request)

            return try await transfers.download(taskId: arguments[0] as! Int, request: request, to: try fileURL(arguments[2]))
        }

        registry.addAsyncFunction("fileSystem.upload") { [transfers] arguments in
            let source = try fileURL(arguments[2])
            var request = URLRequest(url: try webURL(arguments[1]))

            request.httpMethod = arguments[3] as? String
            setHeaders(arguments[4], on: &request)

            guard let form = arguments[5] as? [String: Any] else {
                return try await transfers.upload(taskId: arguments[0] as! Int, request: request, body: source, isTemporary: false)
            }

            let boundary = "nativue-\(UUID().uuidString)"
            let body = try fileOperation { try multipartBody(form, file: source, boundary: boundary) }

            request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

            return try await transfers.upload(taskId: arguments[0] as! Int, request: request, body: body, isTemporary: true)
        }

        registry.addFunction("fileSystem.cancel") { [transfers] arguments in
            transfers.cancel(taskId: arguments[0] as! Int)

            return nil
        }
    }
}

// MARK: - Files

private func fileURL(_ argument: Any) throws -> URL {
    guard let uri = argument as? String, uri.hasPrefix("file://") else {
        throw PluginError(code: "ERR_INVALID_ARGUMENT", message: "Expected a file:// URI")
    }

    let path = String(uri.dropFirst("file://".count))

    return URL(fileURLWithPath: path.removingPercentEncoding ?? path)
}

private func webURL(_ argument: Any) throws -> URL {
    guard let url = (argument as? String).flatMap(URL.init(string:)) else {
        throw PluginError(code: "ERR_INVALID_ARGUMENT", message: "That isn't a valid URL")
    }

    return url
}

/// Foundation's errors as the codes JavaScript checks: ERR_NOT_FOUND for what isn't there.
private func fileOperation<Result>(_ operation: () throws -> Result) throws -> Result {
    do {
        return try operation()
    } catch let error as PluginError {
        throw error
    } catch let error as CocoaError where [.fileNoSuchFile, .fileReadNoSuchFile].contains(error.code) {
        throw PluginError(code: "ERR_NOT_FOUND", message: error.localizedDescription)
    } catch {
        throw PluginError(code: "ERR_UNAVAILABLE", message: error.localizedDescription)
    }
}

private func write(_ data: Data, to url: URL, append: Bool) throws -> Any? {
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)

    guard append, let handle = try? FileHandle(forWritingTo: url) else {
        try data.write(to: url, options: .atomic)

        return nil
    }

    defer { try? handle.close() }
    try handle.seekToEnd()
    try handle.write(contentsOf: data)

    return nil
}

private func info(of url: URL) -> [String: Any] {
    guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path) else {
        return ["exists": false, "isDirectory": false, "size": 0, "modificationTime": 0]
    }

    let isDirectory = attributes[.type] as? FileAttributeType == .typeDirectory
    let modified = attributes[.modificationDate] as? Date

    return [
        "exists": true,
        "isDirectory": isDirectory,
        "size": isDirectory ? 0 : (attributes[.size] as? Int ?? 0),
        "modificationTime": (modified?.timeIntervalSince1970 ?? 0) * 1000,
    ]
}

/// What's at the destination is replaced, and the directories above it made.
private func prepare(_ destination: URL) throws {
    let fileManager = FileManager.default

    try fileManager.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
    if fileManager.fileExists(atPath: destination.path) { try fileManager.removeItem(at: destination) }
}

// MARK: - Transfers

private func setHeaders(_ argument: Any, on request: inout URLRequest) {
    for (name, value) in argument as? [String: Any] ?? [:] {
        request.setValue("\(value)", forHTTPHeaderField: name)
    }
}

/// The form in a temporary file, so a large upload streams from disk: fields, then the file.
private func multipartBody(_ form: [String: Any], file: URL, boundary: String) throws -> URL {
    let body = FileManager.default.temporaryDirectory.appendingPathComponent("nativue-upload-\(UUID().uuidString)")
    let field = form["field"] as! String
    let fileName = form["fileName"] as! String
    let mimeType = form["mimeType"] as! String
    var head = ""

    for (name, value) in form["fields"] as? [String: Any] ?? [:] {
        head += "--\(boundary)\r\nContent-Disposition: form-data; name=\"\(quoted(name))\"\r\n\r\n\(value)\r\n"
    }
    head += "--\(boundary)\r\nContent-Disposition: form-data; name=\"\(quoted(field))\"; filename=\"\(quoted(fileName))\"\r\n"
    head += "Content-Type: \(mimeType)\r\n\r\n"

    FileManager.default.createFile(atPath: body.path, contents: Data(head.utf8))

    let output = try FileHandle(forWritingTo: body)
    let input = try FileHandle(forReadingFrom: file)

    defer {
        try? output.close()
        try? input.close()
    }
    try output.seekToEnd()
    while let chunk = try input.read(upToCount: 1 << 20), !chunk.isEmpty {
        try output.write(contentsOf: chunk)
    }
    try output.write(contentsOf: Data("\r\n--\(boundary)--\r\n".utf8))

    return body
}

private func quoted(_ value: String) -> String {
    value.replacingOccurrences(of: "\"", with: "%22").replacingOccurrences(of: "\r\n", with: " ")
}

/// Every download and upload, on one session whose delegate reports progress. Its state lives on the session's
/// serial queue.
private final class Transfers: NSObject, URLSessionDownloadDelegate, URLSessionDataDelegate {
    /// At most this many progress events a second for each transfer.
    private static let progressInterval: TimeInterval = 0.1

    private struct Running {
        let taskId: Int
        let continuation: CheckedContinuation<Any?, Error>
        /// A download's file, once saved.
        let destination: URL?
        /// An upload's form, deleted when it's done.
        let temporaryBody: URL?
        var responseBody = Data()
        var savingError: Error?
        var lastProgress: TimeInterval = 0
    }

    private let queue: OperationQueue = {
        let queue = OperationQueue()

        queue.maxConcurrentOperationCount = 1

        return queue
    }()
    private lazy var session = URLSession(configuration: .default, delegate: self, delegateQueue: queue)
    private weak var registry: PluginRegistry?
    private var runningByTask: [Int: Running] = [:]
    private var tasksById: [Int: URLSessionTask] = [:]

    func attach(to registry: PluginRegistry) {
        queue.addOperation { [self] in
            self.registry = registry
            tasksById.values.forEach { $0.cancel() }
        }
    }

    func download(taskId: Int, request: URLRequest, to destination: URL) async throws -> Any? {
        try await withCheckedThrowingContinuation { continuation in
            queue.addOperation { [self] in
                start(session.downloadTask(with: request), Running(
                    taskId: taskId, continuation: continuation, destination: destination, temporaryBody: nil
                ))
            }
        }
    }

    func upload(taskId: Int, request: URLRequest, body: URL, isTemporary: Bool) async throws -> Any? {
        try await withCheckedThrowingContinuation { continuation in
            queue.addOperation { [self] in
                start(session.uploadTask(with: request, fromFile: body), Running(
                    taskId: taskId, continuation: continuation, destination: nil, temporaryBody: isTemporary ? body : nil
                ))
            }
        }
    }

    func cancel(taskId: Int) {
        queue.addOperation { [self] in tasksById[taskId]?.cancel() }
    }

    private func start(_ task: URLSessionTask, _ running: Running) {
        runningByTask[task.taskIdentifier] = running
        tasksById[running.taskId] = task
        task.resume()
    }

    private func reportProgress(of task: URLSessionTask, bytes: Int64, totalBytes: Int64) {
        guard var running = runningByTask[task.taskIdentifier] else { return }

        let now = Date.timeIntervalSinceReferenceDate

        guard now - running.lastProgress >= Self.progressInterval || bytes == totalBytes else { return }

        running.lastProgress = now
        runningByTask[task.taskIdentifier] = running
        registry?.sendEvent("fileSystem.progress", ["taskId": running.taskId, "bytes": bytes, "totalBytes": totalBytes])
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
                    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        reportProgress(of: downloadTask, bytes: totalBytesWritten, totalBytes: totalBytesExpectedToWrite)
    }

    /// The system deletes location when this returns: the file is moved now.
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let destination = runningByTask[downloadTask.taskIdentifier]?.destination else { return }

        do {
            try prepare(destination)
            try FileManager.default.moveItem(at: location, to: destination)
        } catch {
            runningByTask[downloadTask.taskIdentifier]?.savingError = error
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
                    totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        reportProgress(of: task, bytes: totalBytesSent, totalBytes: totalBytesExpectedToSend)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        runningByTask[dataTask.taskIdentifier]?.responseBody.append(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let running = runningByTask.removeValue(forKey: task.taskIdentifier) else { return }

        tasksById.removeValue(forKey: running.taskId)
        if let body = running.temporaryBody { try? FileManager.default.removeItem(at: body) }

        if let error = error ?? running.savingError {
            return running.continuation.resume(throwing: transferError(error))
        }

        let response = task.response as? HTTPURLResponse
        var result: [String: Any] = [
            "status": response?.statusCode ?? 0,
            "headers": Dictionary(uniqueKeysWithValues: (response?.allHeaderFields ?? [:]).map { ("\($0.key)".lowercased(), "\($0.value)") }),
        ]

        if let destination = running.destination {
            result["uri"] = destination.absoluteString
        } else {
            result["body"] = String(decoding: running.responseBody, as: UTF8.self)
        }
        running.continuation.resume(returning: result)
    }

    private func transferError(_ error: Error) -> PluginError {
        if (error as? URLError)?.code == .cancelled {
            return PluginError(code: "ERR_CANCELED", message: "The transfer was canceled")
        }

        return PluginError(code: "ERR_UNAVAILABLE", message: error.localizedDescription)
    }
}
