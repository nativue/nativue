import Foundation

/// The bytes behind JS's Blobs, by id. JS holds only the id; the runtime releases it when the garbage
/// collector collects the last Blob pointing to it. Used from the JS queue and from Networking's.
final class BlobStore {
    /// One for the app: <Image> reads `blob:` URLs from it too.
    static let shared = BlobStore()

    private var dataById: [String: Data] = [:]
    private let lock = NSLock()

    func store(_ data: Data) -> String {
        let blobId = UUID().uuidString
        lock.withLock { dataById[blobId] = data }

        return blobId
    }

    /// A slice of a blob's bytes; nil if it's been released.
    func data(blobId: String, offset: Int, size: Int) -> Data? {
        lock.withLock {
            guard let data = dataById[blobId], offset >= 0, size >= 0, offset + size <= data.count else { return nil }

            return data.subdata(in: offset..<(offset + size))
        }
    }

    /// `{ blobId, offset, size }`, as JS describes the bytes it sends.
    func data(of blob: [String: Any]) -> Data? {
        guard let blobId = blob["blobId"] as? String else { return nil }

        return data(blobId: blobId, offset: integer(blob["offset"]), size: integer(blob["size"]))
    }

    /// A `blob:<id>?offset=…&size=…` URL, from URL.createObjectURL.
    func data(forURL url: String) -> Data? {
        guard let components = URLComponents(string: url), components.scheme == "blob" else { return nil }

        let number = { (name: String) in Int(components.queryItems?.first { $0.name == name }?.value ?? "") ?? 0 }

        return data(blobId: components.path, offset: number("offset"), size: number("size"))
    }

    func remove(blobId: String) {
        lock.withLock { _ = dataById.removeValue(forKey: blobId) }
    }

    /// On reload: the Blobs' JS is gone.
    func removeAll() {
        lock.withLock { dataById = [:] }
    }

    /// Joins `{ string }`, `{ base64 }` and `{ blob }` parts into a new blob.
    func create(parts: [[String: Any]]) throws -> (blobId: String, size: Int) {
        var joined = Data()

        for part in parts {
            if let text = part["string"] as? String {
                joined.append(Data(text.utf8))
            } else if let base64 = part["base64"] as? String {
                joined.append(Data(base64Encoded: base64) ?? Data())
            } else if let blob = part["blob"] as? [String: Any] {
                guard let data = data(of: blob) else { throw NetworkingError("The blob has been released") }
                joined.append(data)
            }
        }

        return (store(joined), joined.count)
    }

    private func integer(_ value: Any?) -> Int {
        (value as? NSNumber)?.intValue ?? 0
    }
}
