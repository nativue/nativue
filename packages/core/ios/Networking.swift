import Foundation

/// HTTP requests for XMLHttpRequest (and fetch, built on it). URLSession runs them; their progress comes
/// back as events (see NetworkEventPayloads in types.ts), which the Bridge hands to JS's __networkEvent.
/// Everything, delegate callbacks included, runs on one serial queue.
final class Networking: NSObject, URLSessionDataDelegate {
    /// (who asked, request id, event name, payload).
    var onEvent: ((AnyObject?, Int, String, [String: Any]) -> Void)?

    private final class RequestState {
        let id: Int
        weak var owner: AnyObject?
        let returnsBase64: Bool
        let incrementalUpdates: Bool
        var data = Data()
        var loaded: Int64 = 0
        var expectedLength: Int64 = -1
        /// The start of a UTF-8 character split across chunks.
        var undecodedBytes = Data()
        /// A multipart body written to disk, deleted once the request ends.
        var temporaryFile: URL?

        init(id: Int, owner: AnyObject?, query: [String: Any]) {
            self.id = id
            self.owner = owner
            returnsBase64 = query["responseType"] as? String == "base64"
            incrementalUpdates = query["incrementalUpdates"] as? Bool ?? false
        }

        var streamsText: Bool { incrementalUpdates && !returnsBase64 }

        func deleteTemporaryFile() {
            if let temporaryFile { try? FileManager.default.removeItem(at: temporaryFile) }
        }
    }

    /// What a request sends: bytes in memory, or a file URLSession reads as it uploads.
    private enum Body {
        case none
        case data(Data)
        case file(URL, isTemporary: Bool)
    }

    private let queue: OperationQueue = {
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1

        return queue
    }()

    private lazy var session = URLSession(configuration: .default, delegate: self, delegateQueue: queue)
    private var statesByTaskId: [Int: RequestState] = [:]
    private var tasksByRequestId: [Int: URLSessionTask] = [:]

    func send(requestId: Int, query: [String: Any], owner: AnyObject?) {
        queue.addOperation { [self] in
            let state = RequestState(id: requestId, owner: owner, query: query)

            do {
                var request = try urlRequest(from: query)
                let task: URLSessionTask

                switch try body(query["body"] as? [String: Any], of: &request) {
                case .none:
                    task = session.dataTask(with: request)
                case let .data(data):
                    task = session.uploadTask(with: request, from: data)
                case let .file(file, isTemporary):
                    if isTemporary { state.temporaryFile = file }
                    task = session.uploadTask(with: request, fromFile: file)
                }
                statesByTaskId[task.taskIdentifier] = state
                tasksByRequestId[requestId] = task
                task.resume()
            } catch {
                emit(state, "complete", ["error": error.localizedDescription, "timedOut": false])
            }
        }
    }

    /// JS has already settled the request: nothing more is reported for it.
    func abort(requestId: Int) {
        queue.addOperation { [self] in
            guard let task = tasksByRequestId.removeValue(forKey: requestId) else { return }

            statesByTaskId.removeValue(forKey: task.taskIdentifier)?.deleteTemporaryFile()
            task.cancel()
        }
    }

    /// On reload: the requests' JS is gone.
    func abortAll() {
        queue.addOperation { [self] in
            tasksByRequestId.values.forEach { $0.cancel() }
            statesByTaskId.values.forEach { $0.deleteTemporaryFile() }
            tasksByRequestId = [:]
            statesByTaskId = [:]
        }
    }

    // MARK: URLSessionDataDelegate

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didSendBodyData bytesSent: Int64,
        totalBytesSent: Int64,
        totalBytesExpectedToSend: Int64
    ) {
        guard let state = statesByTaskId[task.taskIdentifier] else { return }

        emit(state, "uploadprogress", ["loaded": totalBytesSent, "total": totalBytesExpectedToSend])
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        completionHandler(.allow)
        guard let state = statesByTaskId[dataTask.taskIdentifier] else { return }

        let httpResponse = response as? HTTPURLResponse
        state.expectedLength = response.expectedContentLength
        emit(state, "response", [
            "status": httpResponse?.statusCode ?? 200,
            "headers": httpResponse?.allHeaderFields ?? [:],
            "url": response.url?.absoluteString ?? "",
        ])
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let state = statesByTaskId[dataTask.taskIdentifier] else { return }

        state.loaded += Int64(data.count)
        let progress: [String: Any] = ["loaded": state.loaded, "total": state.expectedLength]

        if state.streamsText {
            emit(state, "incrementaldata", progress.merging(["text": decodedText(data, of: state)]) { $1 })
            return
        }

        state.data.append(data)
        if state.incrementalUpdates { emit(state, "progress", progress) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let state = statesByTaskId.removeValue(forKey: task.taskIdentifier) else { return }

        tasksByRequestId[state.id] = nil
        state.deleteTemporaryFile()

        if let error {
            let timedOut = (error as? URLError)?.code == .timedOut
            return emit(state, "complete", ["error": error.localizedDescription, "timedOut": timedOut])
        }

        if !state.streamsText {
            let data = state.returnsBase64 ? state.data.base64EncodedString() : decodedText(state.data, of: state)
            emit(state, "data", ["data": data])
        }
        emit(state, "complete", ["error": NSNull(), "timedOut": false])
    }

    // MARK: Requests

    private func emit(_ state: RequestState, _ eventName: String, _ payload: [String: Any]) {
        onEvent?(state.owner, state.id, eventName, payload)
    }

    private func urlRequest(from query: [String: Any]) throws -> URLRequest {
        let urlString = query["url"] as? String ?? ""
        guard let url = URL(string: urlString) else { throw NetworkingError("invalid URL \(urlString)") }

        var request = URLRequest(url: url)
        request.httpMethod = query["method"] as? String ?? "GET"
        request.httpShouldHandleCookies = query["withCredentials"] as? Bool ?? true
        (query["headers"] as? [String: String])?.forEach { request.setValue($1, forHTTPHeaderField: $0) }

        let timeout = query["timeout"] as? Double ?? 0
        if timeout > 0 { request.timeoutInterval = timeout / 1000 }

        return request
    }

    private func body(_ body: [String: Any]?, of request: inout URLRequest) throws -> Body {
        guard let body else { return .none }

        if let text = body["string"] as? String { return .data(Data(text.utf8)) }
        if let base64 = body["base64"] as? String { return .data(Data(base64Encoded: base64) ?? Data()) }
        if let uri = body["uri"] as? String {
            let url = try fileOrDataURL(uri)
            return url.isFileURL ? .file(url, isTemporary: false) : .data(try Data(contentsOf: url))
        }
        guard let parts = body["formData"] as? [[String: Any]] else { return .none }

        let boundary = "nativue-\(UUID().uuidString)"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        return .file(try writeMultipartBody(parts, boundary: boundary), isTemporary: true)
    }

    /// multipart/form-data, written to a temporary file: text fields as they are, files copied in chunks
    /// from their uri, so a large video never sits in memory.
    private func writeMultipartBody(_ parts: [[String: Any]], boundary: String) throws -> URL {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("nativue-upload-\(UUID().uuidString)")
        FileManager.default.createFile(atPath: file.path, contents: nil)
        let output = try FileHandle(forWritingTo: file)
        defer { try? output.close() }

        do {
            for part in parts {
                try writeMultipartPart(part, boundary: boundary, to: output)
            }
            try output.write(contentsOf: Data("--\(boundary)--\r\n".utf8))
        } catch {
            try? FileManager.default.removeItem(at: file)
            throw error
        }

        return file
    }

    private func writeMultipartPart(_ part: [String: Any], boundary: String, to output: FileHandle) throws {
        let name = part["name"] as? String ?? ""
        try output.write(contentsOf: Data("--\(boundary)\r\n".utf8))

        if let value = part["value"] as? String {
            return try output.write(contentsOf: Data("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".utf8))
        }
        guard let uri = part["uri"] as? String else { return }

        let filename = part["filename"] as? String ?? "file"
        let type = part["type"] as? String ?? "application/octet-stream"
        try output.write(contentsOf: Data("Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(filename)\"\r\n".utf8))
        try output.write(contentsOf: Data("Content-Type: \(type)\r\n\r\n".utf8))
        try copyContents(of: try fileOrDataURL(uri), to: output)
        try output.write(contentsOf: Data("\r\n".utf8))
    }

    /// A file in chunks; a data: uri is already in memory.
    private func copyContents(of url: URL, to output: FileHandle) throws {
        guard url.isFileURL else { return try output.write(contentsOf: Data(contentsOf: url)) }

        let input = try FileHandle(forReadingFrom: url)
        defer { try? input.close() }

        while let chunk = try input.read(upToCount: 64 * 1024), !chunk.isEmpty {
            try output.write(contentsOf: chunk)
        }
    }

    private func fileOrDataURL(_ uri: String) throws -> URL {
        guard let url = URL(string: uri), url.isFileURL || url.scheme == "data" else {
            throw NetworkingError("only file: and data: uris can be sent, not \(uri)")
        }

        return url
    }

    /// UTF-8. A character split between chunks waits for the rest in the next one.
    private func decodedText(_ chunk: Data, of state: RequestState) -> String {
        let bytes = state.undecodedBytes + chunk
        let splitLength = incompleteCharacterLength(atEndOf: bytes)
        state.undecodedBytes = bytes.suffix(splitLength)

        return String(decoding: bytes.dropLast(splitLength), as: UTF8.self)
    }

    /// How many bytes at the end start a UTF-8 character that isn't complete yet.
    private func incompleteCharacterLength(atEndOf bytes: Data) -> Int {
        for (distanceFromEnd, byte) in bytes.suffix(4).reversed().enumerated() {
            let isContinuationByte = byte & 0xC0 == 0x80
            if isContinuationByte { continue }

            let characterLength = byte >= 0xF0 ? 4 : byte >= 0xE0 ? 3 : byte >= 0xC0 ? 2 : 1
            let availableLength = distanceFromEnd + 1

            return availableLength < characterLength ? availableLength : 0
        }

        return 0
    }
}

private struct NetworkingError: LocalizedError {
    let errorDescription: String?

    init(_ message: String) {
        errorDescription = message
    }
}
