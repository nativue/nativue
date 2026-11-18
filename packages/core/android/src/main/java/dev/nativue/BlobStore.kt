package dev.nativue

import java.io.ByteArrayOutputStream
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * The bytes behind JS's Blobs, by id. JS holds only the id; the runtime releases it when the garbage
 * collector collects the last Blob pointing to it. Used from the JS thread and from Networking's.
 * Mirrors ios/BlobStore.swift.
 */
class BlobStore private constructor() {
    private val bytesById = ConcurrentHashMap<String, ByteArray>()

    fun store(bytes: ByteArray): String {
        val blobId = UUID.randomUUID().toString()
        bytesById[blobId] = bytes

        return blobId
    }

    /** A slice of a blob's bytes; null if it's been released. */
    fun bytes(blobId: String, offset: Int, size: Int): ByteArray? {
        val bytes = bytesById[blobId] ?: return null
        if (offset < 0 || size < 0 || offset + size > bytes.size) return null

        return bytes.copyOfRange(offset, offset + size)
    }

    /** `{ blobId, offset, size }`, as JS describes the bytes it sends. */
    fun bytes(blob: Map<*, *>): ByteArray? {
        val blobId = blob["blobId"] as? String ?: return null

        return bytes(blobId, (blob["offset"] as? Number)?.toInt() ?: 0, (blob["size"] as? Number)?.toInt() ?: 0)
    }

    /** A `blob:<id>?offset=…&size=…` URL, from URL.createObjectURL. */
    fun bytes(url: String): ByteArray? {
        if (!url.startsWith("blob:")) return null

        val blobId = url.removePrefix("blob:").substringBefore("?")
        val parameters = url.substringAfter("?", "").split("&").associate { it.substringBefore("=") to it.substringAfter("=", "") }

        return bytes(blobId, parameters["offset"]?.toIntOrNull() ?: 0, parameters["size"]?.toIntOrNull() ?: 0)
    }

    fun remove(blobId: String) {
        bytesById.remove(blobId)
    }

    /** On reload: the Blobs' JS is gone. */
    fun removeAll() = bytesById.clear()

    /** Joins `{ string }`, `{ bytes }` and `{ blob }` parts into a new blob; null if a part's blob was released. */
    fun create(parts: List<*>): Pair<String, Int>? {
        val joined = ByteArrayOutputStream()

        for (part in parts.filterIsInstance<Map<*, *>>()) {
            (part["string"] as? String)?.let { joined.write(it.toByteArray()) }
            (part["bytes"] as? ByteArray)?.let { joined.write(it) }
            (part["blob"] as? Map<*, *>)?.let { joined.write(bytes(it) ?: return null) }
        }

        return store(joined.toByteArray()) to joined.size()
    }

    companion object {
        /** One for the app: <Image> reads `blob:` URLs from it too. */
        val shared = BlobStore()
    }
}
