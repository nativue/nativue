package dev.nativue

import android.content.Context
import android.net.Uri
import android.util.Base64
import android.webkit.CookieManager
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FilterInputStream
import java.io.IOException
import java.io.InputStream
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.concurrent.thread

/**
 * HTTP requests for XMLHttpRequest (and fetch, built on it), each on its own thread with HttpURLConnection.
 * Their progress comes back as events (see NetworkEventPayloads in types.ts), which the Bridge hands to
 * JS's __networkEvent. Mirrors ios/Networking.swift.
 */
class Networking(
    private val context: Context,
    private val blobStore: BlobStore,
    private val onEvent: (owner: JavaScriptRuntime?, requestId: Int, eventName: String, payload: Map<String, Any?>) -> Unit,
) {
    private class Request(val id: Int, val owner: JavaScriptRuntime?, query: Map<*, *>) {
        /** 'text', 'bytes' or 'blob'. */
        val responseType = query["responseType"] as? String ?: "text"
        val incrementalUpdates = query["incrementalUpdates"] == true
        val streamsText = incrementalUpdates && responseType == "text"
        val withCredentials = query["withCredentials"] != false

        @Volatile var aborted = false
        @Volatile var connection: HttpURLConnection? = null
    }

    /** What a request sends, read as it uploads; a length of -1 when unknown. */
    private class Body(
        val length: Long,
        val contentType: String? = null,
        val temporaryFile: File? = null,
        val open: () -> InputStream,
    )

    private val requestsById = ConcurrentHashMap<Int, Request>()

    /** The system's, shared with WebViews and kept on disk. Null on a device without a WebView. */
    private val cookies by lazy { runCatching { CookieManager.getInstance() }.getOrNull() }

    fun send(requestId: Int, query: Map<*, *>, owner: JavaScriptRuntime?) {
        val request = Request(requestId, owner, query)
        requestsById[requestId] = request

        thread {
            runCatching { perform(request, query) }.onFailure { error ->
                val failure = mapOf("error" to (error.message ?: error.toString()), "timedOut" to (error is SocketTimeoutException))
                emit(request, "complete", failure)
            }
            requestsById.remove(requestId, request)
        }
    }

    /** JS has already settled the request: nothing more is reported for it. */
    fun abort(requestId: Int) {
        requestsById.remove(requestId)?.let(::cancel)
    }

    /** On reload: the requests' JS is gone. */
    fun abortAll() {
        requestsById.values.forEach(::cancel)
        requestsById.clear()
    }

    private fun cancel(request: Request) {
        request.aborted = true
        request.connection?.disconnect()
    }

    private fun emit(request: Request, eventName: String, payload: Map<String, Any?>) {
        if (!request.aborted) onEvent(request.owner, request.id, eventName, payload)
    }

    private fun perform(request: Request, query: Map<*, *>) {
        val body = (query["body"] as? Map<*, *>)?.let(::body)

        try {
            perform(request, query, body)
        } finally {
            body?.temporaryFile?.delete()
        }
    }

    /**
     * Follows redirects itself, like a browser: so each hop's cookies are kept and sent, and http to https
     * redirects (which HttpURLConnection won't follow) work.
     */
    private fun perform(request: Request, query: Map<*, *>, body: Body?) {
        val firstUrl = URL(query["url"] as String)
        var url = firstUrl
        var method = query["method"] as? String ?: "GET"
        var sentBody = body

        repeat(MAX_REDIRECTS + 1) {
            val headers = (query["headers"] as? Map<*, *>).orEmpty()
                .filterKeys { url.sameOrigin(firstUrl) || !it.toString().equals("Authorization", ignoreCase = true) }
            val connection = connect(request, url, method, headers, (query["timeout"] as? Number)?.toInt() ?: 0)
            if (sentBody != null) upload(request, connection, sentBody)

            val status = connection.responseCode
            if (request.withCredentials) storeCookies(connection)
            val location = connection.getHeaderField("Location")
            if (status !in REDIRECT_STATUSES || location == null) return respond(request, connection, status)

            connection.disconnect()
            url = URL(url, location)
            // As browsers do: 303, and 301/302 after a POST, become a GET without the body.
            if (status == 303 || (status != 307 && status != 308 && method == "POST")) {
                method = "GET"
                sentBody = null
            }
        }
        throw IOException("too many redirects")
    }

    private fun connect(request: Request, url: URL, method: String, headers: Map<*, *>, timeout: Int): HttpURLConnection {
        val connection = url.openConnection() as HttpURLConnection
        request.connection = connection
        if (request.aborted) throw IOException("aborted")

        connection.instanceFollowRedirects = false
        connection.requestMethod = method
        connection.connectTimeout = timeout
        connection.readTimeout = timeout
        headers.forEach { (name, value) -> connection.setRequestProperty(name.toString(), value.toString()) }
        if (request.withCredentials) sendCookies(connection)

        return connection
    }

    private fun URL.sameOrigin(other: URL) = protocol == other.protocol && host == other.host && port == other.port

    private fun respond(request: Request, connection: HttpURLConnection, status: Int) {
        val headers = connection.headerFields.filterKeys { it != null }.mapValues { it.value.joinToString(", ") }
        emit(request, "response", mapOf("status" to status, "headers" to headers, "url" to connection.url.toString()))

        val stream = (if (status >= 400) connection.errorStream else connection.inputStream) ?: ByteArray(0).inputStream()
        download(request, CountingInputStream(stream), connection.contentLengthLong, connection.contentType)
        emit(request, "complete", mapOf("error" to null, "timedOut" to false))
    }

    private fun sendCookies(connection: HttpURLConnection) {
        val cookie = cookies?.getCookie(connection.url.toString()) ?: return

        connection.setRequestProperty("Cookie", cookie)
    }

    private fun storeCookies(connection: HttpURLConnection) {
        val cookies = cookies ?: return
        val url = connection.url.toString()

        connection.headerFields
            .filterKeys { it.equals("Set-Cookie", ignoreCase = true) }
            .values.flatten()
            .forEach { cookies.setCookie(url, it) }
        cookies.flush()
    }

    /** What to send, or null for none. */
    private fun body(body: Map<*, *>): Body? {
        (body["string"] as? String)?.let { return bytesBody(it.toByteArray()) }
        (body["bytes"] as? ByteArray)?.let { return bytesBody(it) }
        (body["blob"] as? Map<*, *>)?.let { return bytesBody(blobBytes(it)) }
        (body["uri"] as? String)?.let { uri -> return Body(-1) { openUri(uri) } }

        val parts = (body["formData"] as? List<*>)?.filterIsInstance<Map<*, *>>() ?: return null
        val boundary = "nativue-${UUID.randomUUID()}"
        val file = writeMultipartBody(parts, boundary)

        return Body(file.length(), "multipart/form-data; boundary=$boundary", file) { file.inputStream() }
    }

    private fun bytesBody(bytes: ByteArray) = Body(bytes.size.toLong()) { bytes.inputStream() }

    /** In chunks, so `xhr.upload.onprogress` can follow and a large file never sits in memory. */
    private fun upload(request: Request, connection: HttpURLConnection, body: Body) {
        connection.doOutput = true
        body.contentType?.let { connection.setRequestProperty("Content-Type", it) }
        if (body.length >= 0) connection.setFixedLengthStreamingMode(body.length) else connection.setChunkedStreamingMode(CHUNK_SIZE)

        var loaded = 0L
        body.open().use { input ->
            connection.outputStream.use { output ->
                val buffer = ByteArray(CHUNK_SIZE)
                while (true) {
                    val length = input.read(buffer)
                    if (length < 0) break
                    output.write(buffer, 0, length)
                    loaded += length
                    emit(request, "uploadprogress", mapOf("loaded" to loaded, "total" to body.length))
                }
            }
        }
    }

    private fun download(request: Request, stream: CountingInputStream, expectedLength: Long, contentType: String?) {
        fun progress() = mapOf("loaded" to stream.count, "total" to expectedLength)

        if (request.streamsText) {
            // The reader keeps a character split between chunks for the next one.
            InputStreamReader(stream, Charsets.UTF_8).use { reader ->
                val buffer = CharArray(CHUNK_SIZE)
                while (true) {
                    val length = reader.read(buffer)
                    if (length < 0) break
                    emit(request, "incrementaldata", progress() + ("text" to String(buffer, 0, length)))
                }
            }
            return
        }

        val bytes = ByteArrayOutputStream()
        stream.use {
            val buffer = ByteArray(CHUNK_SIZE)
            while (true) {
                val length = it.read(buffer)
                if (length < 0) break
                bytes.write(buffer, 0, length)
                if (request.incrementalUpdates) emit(request, "progress", progress())
            }
        }

        emit(request, "data", mapOf("data" to responseData(request, bytes.toByteArray(), contentType)))
    }

    /** Text, the bytes, or for 'blob' the bytes kept in the BlobStore, described as a NativeBlob. */
    private fun responseData(request: Request, bytes: ByteArray, contentType: String?): Any = when (request.responseType) {
        "bytes" -> bytes
        "blob" -> {
            val type = contentType?.substringBefore(";")?.trim().orEmpty()
            val blobId = blobStore.store(bytes)

            // A reload aborts the request before clearing the store: stored after that, nothing would release it.
            if (request.aborted) blobStore.remove(blobId)

            mapOf("blobId" to blobId, "offset" to 0, "size" to bytes.size, "type" to type)
        }
        else -> String(bytes, Charsets.UTF_8)
    }

    /**
     * multipart/form-data, written to a temporary file: text fields as they are, files copied from their uri
     * (content:, file: or data:), so a large video never sits in memory.
     */
    private fun writeMultipartBody(parts: List<Map<*, *>>, boundary: String): File {
        val file = File.createTempFile("nativue-upload-", null, context.cacheDir)

        try {
            file.outputStream().buffered().use { writeMultipartParts(parts, boundary, it) }
        } catch (error: Throwable) {
            file.delete()
            throw error
        }

        return file
    }

    private fun writeMultipartParts(parts: List<Map<*, *>>, boundary: String, body: OutputStream) {
        fun write(text: String) = body.write(text.toByteArray())

        for (part in parts) {
            val name = part["name"] as? String ?: ""
            write("--$boundary\r\n")

            val value = part["value"] as? String
            if (value != null) {
                write("Content-Disposition: form-data; name=\"$name\"\r\n\r\n$value\r\n")
                continue
            }

            val uri = part["uri"] as? String
            val blob = part["blob"] as? Map<*, *>
            if (uri == null && blob == null) continue

            val filename = part["filename"] as? String ?: "file"
            val type = part["type"] as? String ?: "application/octet-stream"
            write("Content-Disposition: form-data; name=\"$name\"; filename=\"$filename\"\r\n")
            write("Content-Type: $type\r\n\r\n")
            if (uri != null) openUri(uri).use { it.copyTo(body) }
            if (blob != null) body.write(blobBytes(blob))
            write("\r\n")
        }
        write("--$boundary--\r\n")
    }

    private fun blobBytes(blob: Map<*, *>) = blobStore.bytes(blob) ?: throw IOException("The blob has been released")

    private fun openUri(uri: String): InputStream {
        if (uri.startsWith("data:")) return Base64.decode(uri.substringAfter(","), Base64.DEFAULT).inputStream()

        return context.contentResolver.openInputStream(Uri.parse(uri)) ?: throw IllegalArgumentException("can't read $uri")
    }

    /** Counts the bytes read, for download progress. */
    private class CountingInputStream(stream: InputStream) : FilterInputStream(stream) {
        var count = 0L
            private set

        override fun read(): Int = super.read().also { if (it >= 0) count++ }

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
            super.read(buffer, offset, length).also { if (it > 0) count += it }
    }

    companion object {
        /** 64 KB: progress often enough, without an event per few bytes. */
        private const val CHUNK_SIZE = 64 * 1024

        /** Browsers stop at 20 too. */
        private const val MAX_REDIRECTS = 20

        private val REDIRECT_STATUSES = setOf(301, 302, 303, 307, 308)
    }
}
