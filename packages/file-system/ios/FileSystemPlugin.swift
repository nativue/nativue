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

                guard try checkSource(source, destination: destination) else { return nil }

                try prepare(destination)
                try FileManager.default.copyItem(at: source, to: destination)

                return nil
            }
        }

        registry.addAsyncFunction("fileSystem.move") { arguments in
            try fileOperation {
                let (source, destination) = (try fileURL(arguments[0]), try fileURL(arguments[1]))

                guard try checkSource(source, destination: destination) else { return nil }

                try prepare(destination)
                try FileManager.default.moveItem(at: source, to: destination)

                return nil
            }
        }

        registry.addAsyncFunction("fileSystem.download") { [transfers] arguments in
            var request = URLRequest(url: try webURL(arguments[1]))

            setHeaders(arguments[3], on: &request)

            return try await transfers.download(taskId: taskId(arguments[0]), request: request, to: try fileURL(arguments[2]))
        }

        registry.addAsyncFunction("fileSystem.upload") { [transfers] arguments in
            let source = try fileURL(arguments[2])
            let form = arguments[5] as? [String: Any]
            let range = try byteRange(of: source, offset: arguments[6], length: arguments[7])
            var request = URLRequest(url: try webURL(arguments[1]))

            request.httpMethod = arguments[3] as? String
            setHeaders(arguments[4], on: &request)

            guard form != nil || range != nil else {
                return try await transfers.upload(taskId: taskId(arguments[0]), request: request, body: source, isTemporary: false)
            }

            let boundary = "nativue-\(UUID().uuidString)"
            let body = try fileOperation { try uploadBody(form: form, file: source, range: range, boundary: boundary) }

            if form != nil {
                request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
            }

            return try await transfers.upload(taskId: taskId(arguments[0]), request: request, body: body, isTemporary: true)
        }

        registry.addFunction("fileSystem.cancel") { [transfers] arguments in
            transfers.cancel(taskId: taskId(arguments[0]), keepingWhatArrived: arguments[1] as? Bool ?? false)

            return nil
        }

        registry.addAsyncFunction("fileSystem.discardDownload") { arguments in
            try fileOperation {
                try PartialDownload(destination: fileURL(arguments[0])).discard()

                return nil
            }
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

/// false when there's nothing to do: the source is the destination. A source that doesn't exist, or a directory
/// copied into itself, throws before the destination is touched.
private func checkSource(_ source: URL, destination: URL) throws -> Bool {
    let (sourcePath, destinationPath) = (source.standardizedFileURL.path, destination.standardizedFileURL.path)

    guard FileManager.default.fileExists(atPath: sourcePath) else {
        throw PluginError(code: "ERR_NOT_FOUND", message: "\(sourcePath) doesn't exist")
    }
    guard !destinationPath.hasPrefix(sourcePath + "/") else {
        throw PluginError(code: "ERR_INVALID_ARGUMENT", message: "A directory can't go inside itself")
    }

    return sourcePath != destinationPath
}

/// What's at the destination is replaced, and the directories above it made.
private func prepare(_ destination: URL) throws {
    let fileManager = FileManager.default

    try fileManager.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
    if fileManager.fileExists(atPath: destination.path) { try fileManager.removeItem(at: destination) }
}

// MARK: - Transfers

/// JavaScript numbers arrive as Int or Double.
private func taskId(_ argument: Any) -> Int {
    (argument as? Int) ?? Int(argument as! Double)
}

private func setHeaders(_ argument: Any, on request: inout URLRequest) {
    for (name, value) in argument as? [String: Any] ?? [:] {
        request.setValue("\(value)", forHTTPHeaderField: name)
    }
}

/// nil for the whole file. A length of -1 runs to the end.
private func byteRange(of file: URL, offset: Any, length: Any) throws -> Range<Int64>? {
    let attributes = try fileOperation { try FileManager.default.attributesOfItem(atPath: file.path) }
    let size = Int64(attributes[.size] as? Int ?? 0)
    let start = Int64(taskId(offset))
    let requested = Int64(taskId(length))

    guard start > 0 || requested >= 0 else { return nil }
    guard start <= size else {
        throw PluginError(code: "ERR_INVALID_ARGUMENT", message: "offset is past the end of the file")
    }

    return start..<(requested < 0 ? size : min(size, start + requested))
}

/// The body in a temporary file, so a large upload streams from disk: a form's fields, then the file or its range.
private func uploadBody(form: [String: Any]?, file: URL, range: Range<Int64>?, boundary: String) throws -> URL {
    let body = FileManager.default.temporaryDirectory.appendingPathComponent("nativue-upload-\(UUID().uuidString)")
    var head = ""

    if let form {
        for (name, value) in form["fields"] as? [String: Any] ?? [:] {
            head += "--\(boundary)\r\nContent-Disposition: form-data; name=\"\(quoted(name))\"\r\n\r\n\(value)\r\n"
        }
        head += "--\(boundary)\r\nContent-Disposition: form-data; name=\"\(quoted(form["field"] as! String))\"; "
        head += "filename=\"\(quoted(form["fileName"] as! String))\"\r\nContent-Type: \(form["mimeType"] as! String)\r\n\r\n"
    }

    FileManager.default.createFile(atPath: body.path, contents: Data(head.utf8))

    do {
        let output = try FileHandle(forWritingTo: body)
        let input = try FileHandle(forReadingFrom: file)

        defer {
            try? output.close()
            try? input.close()
        }
        try output.seekToEnd()
        try input.seek(toOffset: UInt64(range?.lowerBound ?? 0))

        var remaining = range.map { $0.upperBound - $0.lowerBound } ?? Int64.max

        while remaining > 0, let chunk = try input.read(upToCount: Int(min(remaining, 1 << 20))), !chunk.isEmpty {
            try output.write(contentsOf: chunk)
            remaining -= Int64(chunk.count)
        }
        if form != nil { try output.write(contentsOf: Data("\r\n--\(boundary)--\r\n".utf8)) }
    } catch {
        try? FileManager.default.removeItem(at: body)
        throw error
    }

    return body
}

private func quoted(_ value: String) -> String {
    value.replacingOccurrences(of: "\"", with: "%22")
        .replacingOccurrences(of: "\r", with: " ")
        .replacingOccurrences(of: "\n", with: " ")
}

/// What a download has received so far, beside its destination, and what names the server's file: the next
/// download to the same place asks only for the rest, if the file hasn't changed.
private struct PartialDownload {
    let destination: URL
    let file: URL
    private let record: URL

    init(destination: URL) {
        self.destination = destination
        file = destination.deletingLastPathComponent().appendingPathComponent(".\(destination.lastPathComponent).partial")
        record = file.appendingPathExtension("json")
    }

    /// Bytes already here, and the If-Range to ask for the rest with: nil when it can't resume.
    func resumption(for url: URL) -> (offset: Int64, validator: String)? {
        guard let data = try? Data(contentsOf: record),
              let saved = try? JSONSerialization.jsonObject(with: data) as? [String: String],
              saved["url"] == url.absoluteString,
              let validator = saved["validator"],
              let size = (try? FileManager.default.attributesOfItem(atPath: file.path))?[.size] as? Int,
              size > 0 else { return nil }

        return (Int64(size), validator)
    }

    /// The ETag, or else Last-Modified: without either the server can't say its file is the same.
    func remember(_ response: HTTPURLResponse, for url: URL) {
        guard let validator = response.value(forHTTPHeaderField: "ETag") ?? response.value(forHTTPHeaderField: "Last-Modified"),
              let data = try? JSONSerialization.data(withJSONObject: ["url": url.absoluteString, "validator": validator])
        else {
            try? FileManager.default.removeItem(at: record)

            return
        }

        try? data.write(to: record)
    }

    func prepareFile() throws {
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        if !FileManager.default.fileExists(atPath: file.path) {
            FileManager.default.createFile(atPath: file.path, contents: nil)
        }
    }

    func finish() throws {
        try prepare(destination)
        try FileManager.default.moveItem(at: file, to: destination)
        try? FileManager.default.removeItem(at: record)
    }

    func discard() throws {
        for url in [file, record] where FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
    }
}

/// Every download and upload, on one session whose delegate writes downloads and reports progress. Its state
/// lives on the session's serial queue.
private final class Transfers: NSObject, URLSessionDataDelegate {
    /// At most this many progress events a second for each transfer.
    private static let progressInterval: TimeInterval = 0.1

    private final class Running {
        let taskId: Int
        let continuation: CheckedContinuation<Any?, Error>
        /// A download's request as JavaScript made it, without the range asked for.
        let request: URLRequest
        let partial: PartialDownload?
        /// Where the range asked for starts: what must already be in the partial file.
        var resumedAt: Int64 = 0
        /// An upload's body made for it, deleted when it's done.
        let temporaryBody: URL?
        var output: FileHandle?
        var responseBody = Data()
        var bytes: Int64 = 0
        var totalBytes: Int64 = -1
        var writingError: Error?
        var keepsWhatArrived = false
        var restartsWithoutRange = false
        var lastProgress: TimeInterval = 0

        init(taskId: Int, continuation: CheckedContinuation<Any?, Error>, request: URLRequest,
             partial: PartialDownload?, temporaryBody: URL?) {
            self.taskId = taskId
            self.continuation = continuation
            self.request = request
            self.partial = partial
            self.temporaryBody = temporaryBody
        }
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
    /// Canceled before they started: a cancel can arrive first.
    private var canceledIds: [Int: Bool] = [:]

    func attach(to registry: PluginRegistry) {
        queue.addOperation { [self] in
            self.registry = registry
            tasksById.values.forEach { $0.cancel() }
        }
    }

    func download(taskId: Int, request: URLRequest, to destination: URL) async throws -> Any? {
        try await withCheckedThrowingContinuation { continuation in
            queue.addOperation { [self] in
                let running = Running(
                    taskId: taskId, continuation: continuation, request: request,
                    partial: PartialDownload(destination: destination), temporaryBody: nil
                )

                start(session.dataTask(with: rangeRequest(for: running)), running)
            }
        }
    }

    func upload(taskId: Int, request: URLRequest, body: URL, isTemporary: Bool) async throws -> Any? {
        try await withCheckedThrowingContinuation { continuation in
            queue.addOperation { [self] in
                start(session.uploadTask(with: request, fromFile: body), Running(
                    taskId: taskId, continuation: continuation, request: request,
                    partial: nil, temporaryBody: isTemporary ? body : nil
                ))
            }
        }
    }

    /// keepingWhatArrived: a pause, which the next download to the same place resumes.
    func cancel(taskId: Int, keepingWhatArrived: Bool) {
        queue.addOperation { [self] in
            guard let task = tasksById[taskId] else {
                canceledIds[taskId] = keepingWhatArrived

                return
            }

            runningByTask[task.taskIdentifier]?.keepsWhatArrived = keepingWhatArrived
            task.cancel()
        }
    }

    private func rangeRequest(for running: Running) -> URLRequest {
        var request = running.request

        running.resumedAt = 0
        if let url = request.url, let (offset, validator) = running.partial?.resumption(for: url) {
            running.resumedAt = offset
            request.setValue("bytes=\(offset)-", forHTTPHeaderField: "Range")
            request.setValue(validator, forHTTPHeaderField: "If-Range")
        }

        return request
    }

    private func start(_ task: URLSessionTask, _ running: Running) {
        if let keepsWhatArrived = canceledIds.removeValue(forKey: running.taskId) {
            task.cancel()
            if let body = running.temporaryBody { try? FileManager.default.removeItem(at: body) }
            if !keepsWhatArrived { try? running.partial?.discard() }

            return running.continuation.resume(throwing: transferError(URLError(.cancelled)))
        }

        runningByTask[task.taskIdentifier] = running
        tasksById[running.taskId] = task
        task.resume()
    }

    private func reportProgress(of running: Running, bytes: Int64, totalBytes: Int64) {
        let now = Date.timeIntervalSinceReferenceDate

        guard now - running.lastProgress >= Self.progressInterval || bytes == totalBytes else { return }

        running.lastProgress = now
        registry?.sendEvent("fileSystem.progress", ["taskId": running.taskId, "bytes": bytes, "totalBytes": totalBytes])
    }

    /// 206: the rest of what's here. Anything else starts over; a 416 (what's here can't be continued) asks again,
    /// for the whole file.
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let running = runningByTask[dataTask.taskIdentifier], let partial = running.partial,
              let response = response as? HTTPURLResponse, let url = running.request.url else {
            return completionHandler(.allow)
        }

        if response.statusCode == 416 {
            running.restartsWithoutRange = true

            return completionHandler(.cancel)
        }

        do {
            let resumes = response.statusCode == 206

            if !resumes { try partial.discard() }
            try partial.prepareFile()

            let output = try FileHandle(forWritingTo: partial.file)

            running.bytes = try output.seekToEnd().asInt64

            // The cache folder can be emptied meanwhile: the rest only goes after what was asked for.
            if resumes && running.bytes != running.resumedAt {
                try? output.close()
                running.restartsWithoutRange = true

                return completionHandler(.cancel)
            }
            running.totalBytes = response.expectedContentLength < 0 ? -1 : running.bytes + response.expectedContentLength
            running.output = output
            partial.remember(response, for: url)
            completionHandler(.allow)
        } catch {
            running.writingError = error
            completionHandler(.cancel)
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let running = runningByTask[dataTask.taskIdentifier] else { return }
        guard let output = running.output else { return running.responseBody.append(data) }

        do {
            try output.write(contentsOf: data)
            running.bytes += Int64(data.count)
            reportProgress(of: running, bytes: running.bytes, totalBytes: running.totalBytes)
        } catch {
            running.writingError = error
            dataTask.cancel()
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
                    totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        guard let running = runningByTask[task.taskIdentifier] else { return }

        reportProgress(of: running, bytes: totalBytesSent, totalBytes: totalBytesExpectedToSend)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let running = runningByTask.removeValue(forKey: task.taskIdentifier) else { return }

        tasksById.removeValue(forKey: running.taskId)
        try? running.output?.close()
        if let body = running.temporaryBody { try? FileManager.default.removeItem(at: body) }

        if running.restartsWithoutRange, let partial = running.partial {
            running.restartsWithoutRange = false
            try? partial.discard()

            return start(session.dataTask(with: running.request), running)
        }

        if let error = running.writingError ?? error {
            // Kept for the next download to resume, unless canceled for good or the server can't resume it.
            let isThrownAway = (error as? URLError)?.code == .cancelled && !running.keepsWhatArrived

            if let partial = running.partial, let url = running.request.url,
               isThrownAway || partial.resumption(for: url) == nil {
                try? partial.discard()
            }

            return running.continuation.resume(throwing: transferError(error))
        }

        let response = task.response as? HTTPURLResponse
        var result: [String: Any] = [
            "status": response?.statusCode ?? 0,
            "headers": Dictionary(
                (response?.allHeaderFields ?? [:]).map { ("\($0.key)".lowercased(), "\($0.value)") },
                uniquingKeysWith: { first, second in "\(first), \(second)" }
            ),
        ]

        if let partial = running.partial {
            do {
                try partial.finish()
            } catch {
                return running.continuation.resume(throwing: transferError(error))
            }
            reportProgress(of: running, bytes: running.bytes, totalBytes: running.bytes)
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

private extension UInt64 {
    var asInt64: Int64 { Int64(self) }
}
