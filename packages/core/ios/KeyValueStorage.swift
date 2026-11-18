import Foundation

/// Behind AsyncStorage. Every value lives in memory, so reads never touch the disk; changes
/// are saved to a file in the background, coalesced, so a burst of writes costs one save. Used only on
/// the JS queue; the save itself runs on its own queue with a snapshot.
/// ponytail: each save rewrites the whole file; switch to SQLite or an append log if data grows large.
final class KeyValueStorage {
    private let javaScriptQueue: DispatchQueue
    private let saveQueue = DispatchQueue(label: "dev.nativue.storage", qos: .utility)
    private let fileURL: URL
    private lazy var values: [String: String] = load()
    private var isSaveScheduled = false

    init(javaScriptQueue: DispatchQueue) {
        self.javaScriptQueue = javaScriptQueue

        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        fileURL = directory.appending(path: "async-storage.json")
    }

    func value(forKey key: String) -> String? {
        values[key]
    }

    var keys: [String] {
        Array(values.keys)
    }

    func setValue(_ value: String, forKey key: String) {
        values[key] = value
        scheduleSave()
    }

    func removeValue(forKey key: String) {
        values[key] = nil
        scheduleSave()
    }

    func removeAll() {
        values = [:]
        scheduleSave()
    }

    private func load() -> [String: String] {
        guard let data = try? Data(contentsOf: fileURL) else { return [:] }

        return (try? JSONDecoder().decode([String: String].self, from: data)) ?? [:]
    }

    private func scheduleSave() {
        guard !isSaveScheduled else { return }

        isSaveScheduled = true
        javaScriptQueue.asyncAfter(deadline: .now() + .milliseconds(50)) { [self] in
            isSaveScheduled = false
            let snapshot = values

            saveQueue.async { [fileURL] in
                guard let data = try? JSONEncoder().encode(snapshot) else { return }

                try? data.write(to: fileURL, options: .atomic)
            }
        }
    }
}
