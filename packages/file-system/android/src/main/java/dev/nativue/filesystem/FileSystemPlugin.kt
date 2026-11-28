package dev.nativue.filesystem

import android.net.Uri
import android.os.SystemClock
import android.util.Base64
import dev.nativue.NativuePlugin
import dev.nativue.PluginRegistry
import dev.nativue.Promise
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.ProtocolException
import java.net.URL
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import org.json.JSONException
import org.json.JSONObject

/**
 * FileSystem (src/index.ts): files under file:// URIs, and downloads and uploads that report their progress
 * as fileSystem.progress. Files go one at a time on a worker thread; each transfer gets a thread of its own.
 */
class FileSystemPlugin : NativuePlugin {
    private val fileWorker = Executors.newSingleThreadExecutor()
    private val transferWorkers = Executors.newCachedThreadPool()
    private val runningTransfers = ConcurrentHashMap<Long, Transfer>()
    /** One download to a destination at a time: two would write the same partial file. */
    private val busyDestinations = ConcurrentHashMap.newKeySet<String>()

    private class Transfer {
        @Volatile var isCanceled = false
        /** A pause: what a download received stays for the next one to resume. */
        @Volatile var keepsWhatArrived = false
        @Volatile var connection: HttpURLConnection? = null

        fun cancel(keepingWhatArrived: Boolean = false) {
            keepsWhatArrived = keepingWhatArrived
            isCanceled = true
            connection?.disconnect()
        }
    }

    override fun register(registry: PluginRegistry) {

        registry.addFunction("fileSystem.paths") { _ ->
            mapOf(
                "document" to directoryUri(registry.applicationContext.filesDir),
                "cache" to directoryUri(registry.applicationContext.cacheDir),
            )
        }

        addFileFunction(registry, "fileSystem.readText") { arguments -> utf8Text(file(arguments[0]).readBytes()) }
        addFileFunction(registry, "fileSystem.readBase64") { arguments ->
            Base64.encodeToString(file(arguments[0]).readBytes(), Base64.NO_WRAP)
        }
        addFileFunction(registry, "fileSystem.writeText") { arguments ->
            write(file(arguments[0]), (arguments[1] as String).toByteArray(), append = arguments[2] as Boolean)
        }
        addFileFunction(registry, "fileSystem.writeBase64") { arguments ->
            val bytes = try {
                Base64.decode(arguments[1] as String, Base64.DEFAULT)
            } catch (error: IllegalArgumentException) {
                throw FileError("ERR_INVALID_ARGUMENT", "That isn't base64")
            }

            write(file(arguments[0]), bytes, append = arguments[2] as Boolean)
        }
        addFileFunction(registry, "fileSystem.getInfo") { arguments -> info(file(arguments[0])) }
        addFileFunction(registry, "fileSystem.delete") { arguments ->
            val target = file(arguments[0])

            if (target.exists() && !target.deleteRecursively()) throw IOException("Couldn't delete ${target.path}")
            null
        }
        addFileFunction(registry, "fileSystem.makeDirectory") { arguments ->
            val directory = file(arguments[0])

            if (!directory.isDirectory && !directory.mkdirs()) throw IOException("Couldn't make ${directory.path}")
            null
        }
        addFileFunction(registry, "fileSystem.list") { arguments ->
            val directory = file(arguments[0])

            if (!directory.exists()) throw FileNotFoundException("${directory.path} doesn't exist")
            directory.list()?.sorted() ?: throw IOException("${directory.path} isn't a directory")
        }
        addFileFunction(registry, "fileSystem.copy") { arguments ->
            val (source, destination) = file(arguments[0]) to file(arguments[1])

            if (!checkSource(source, destination)) return@addFileFunction null
            prepare(destination)
            if (!source.copyRecursively(destination)) throw IOException("Couldn't copy ${source.path}")
            null
        }
        addFileFunction(registry, "fileSystem.move") { arguments ->
            val (source, destination) = file(arguments[0]) to file(arguments[1])

            if (!checkSource(source, destination)) return@addFileFunction null
            prepare(destination)
            // Across filesystems a rename fails: then it's a copy and a delete.
            if (!source.renameTo(destination)) {
                source.copyRecursively(destination)
                source.deleteRecursively()
            }
            null
        }

        registry.addAsyncFunction("fileSystem.download") { arguments, promise ->
            val taskId = (arguments[0] as Number).toLong()

            transfer(taskId, promise) { transfer ->
                val destination = file(arguments[2])

                if (!busyDestinations.add(destination.canonicalPath)) {
                    throw FileError("ERR_UNAVAILABLE", "Another download to ${destination.path} is running")
                }
                try {
                    download(registry, taskId, transfer, arguments[1] as String, destination, headers(arguments[3]))
                } finally {
                    busyDestinations.remove(destination.canonicalPath)
                }
            }
        }

        registry.addAsyncFunction("fileSystem.upload") { arguments, promise ->
            val taskId = (arguments[0] as Number).toLong()

            transfer(taskId, promise) { transfer ->
                val source = file(arguments[2])

                @Suppress("UNCHECKED_CAST")
                upload(
                    registry, taskId, transfer, arguments[1] as String, source,
                    method = arguments[3] as String,
                    headers = headers(arguments[4]),
                    form = arguments[5] as Map<String, Any>?,
                    range = byteRange(source, (arguments[6] as Number).toLong(), (arguments[7] as Number).toLong()),
                )
            }
        }

        registry.addFunction("fileSystem.cancel") { arguments ->
            runningTransfers[(arguments[0] as Number).toLong()]?.cancel(keepingWhatArrived = arguments[1] as? Boolean ?: false)
            null
        }

        // A new runtime's first call: a reload's transfers have no one left to answer. Downloads keep what arrived.
        registry.addFunction("fileSystem.cancelAll") { _ ->
            runningTransfers.values.forEach { it.cancel(keepingWhatArrived = true) }
            null
        }

        addFileFunction(registry, "fileSystem.discardDownload") { arguments ->
            PartialDownload(file(arguments[0])).discard()
            null
        }
    }

    private class FileError(val code: String, message: String) : Exception(message)

    /** Java's errors as the codes JavaScript checks: ERR_NOT_FOUND for what isn't there. */
    private fun addFileFunction(registry: PluginRegistry, name: String, operation: (List<Any?>) -> Any?) {
        registry.addAsyncFunction(name) { arguments, promise ->
            fileWorker.execute {
                try {
                    promise.resolve(operation(arguments))
                } catch (error: FileError) {
                    promise.reject(error.code, error.message ?: "")
                } catch (error: FileNotFoundException) {
                    promise.reject("ERR_NOT_FOUND", error.message ?: "Not found")
                } catch (error: Exception) {
                    promise.reject("ERR_UNAVAILABLE", error.message ?: error.toString())
                }
            }
        }
    }

    private fun file(argument: Any?): File {
        val uri = argument as? String

        if (uri == null || !uri.startsWith("file://")) throw FileError("ERR_INVALID_ARGUMENT", "Expected a file:// URI")

        return File(Uri.decode(uri.removePrefix("file://")))
    }

    private fun directoryUri(directory: File) = "${Uri.fromFile(directory)}/"

    private fun write(target: File, bytes: ByteArray, append: Boolean): Any? {
        target.parentFile?.mkdirs()
        if (append) target.appendBytes(bytes) else writeAtomically(target) { it.write(bytes) }

        return null
    }

    /** Written beside it, then renamed over it: a failure halfway leaves the old file whole. */
    private fun writeAtomically(target: File, writeTo: (OutputStream) -> Unit) {
        val partial = File(target.parentFile, ".${target.name}.${UUID.randomUUID()}.partial")

        try {
            partial.outputStream().use(writeTo)
            if (!partial.renameTo(target)) throw IOException("Couldn't save ${target.path}")
        } finally {
            partial.delete()
        }
    }

    private fun info(target: File) = mapOf(
        "exists" to target.exists(),
        "isDirectory" to target.isDirectory,
        "size" to if (target.isFile) target.length() else 0L,
        "modificationTime" to target.lastModified(),
    )

    /**
     * false when there's nothing to do: the source is the destination. A source that doesn't exist, or a
     * directory copied into itself, throws before the destination is touched.
     */
    private fun checkSource(source: File, destination: File): Boolean {
        val (sourcePath, destinationPath) = source.canonicalPath to destination.canonicalPath

        if (!source.exists()) throw FileNotFoundException("$sourcePath doesn't exist")
        if (destinationPath.startsWith("$sourcePath/")) {
            throw FileError("ERR_INVALID_ARGUMENT", "A directory can't go inside itself")
        }

        return sourcePath != destinationPath
    }

    /** Malformed bytes reject, as on iOS, instead of becoming replacement characters. */
    private fun utf8Text(bytes: ByteArray): String = try {
        Charsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(bytes))
            .toString()
    } catch (error: CharacterCodingException) {
        throw FileError("ERR_INVALID_ARGUMENT", "The file isn't UTF-8 text: read it as base64")
    }

    /** What's at the destination is replaced, and the directories above it made. */
    private fun prepare(destination: File) {
        destination.parentFile?.mkdirs()
        if (destination.exists() && !destination.deleteRecursively()) {
            throw IOException("Couldn't replace ${destination.path}")
        }
    }

    // ---------- Transfers ----------

    private fun headers(argument: Any?): Map<String, String> =
        (argument as? Map<*, *>)?.entries?.associate { (name, value) -> name.toString() to value.toString() }.orEmpty()

    private fun transfer(taskId: Long, promise: Promise, work: (Transfer) -> Map<String, Any>) {
        val transfer = Transfer()

        runningTransfers[taskId] = transfer
        transferWorkers.execute {
            try {
                promise.resolve(work(transfer))
            } catch (error: Exception) {
                when {
                    transfer.isCanceled -> promise.reject("ERR_CANCELED", "The transfer was canceled")
                    error is FileError -> promise.reject(error.code, error.message ?: "")
                    else -> promise.reject("ERR_UNAVAILABLE", error.message ?: error.toString())
                }
            } finally {
                runningTransfers.remove(taskId, transfer)
            }
        }
    }

    private fun open(transfer: Transfer, url: String, method: String, headers: Map<String, String>): HttpURLConnection {
        val connection = URL(url).openConnection() as HttpURLConnection

        transfer.connection = connection
        if (transfer.isCanceled) throw IOException("Canceled")
        // Without them, a connection that stops sending, without closing, would hang forever; iOS waits as long.
        connection.connectTimeout = TIMEOUT_MS
        connection.readTimeout = TIMEOUT_MS
        setMethod(connection, method)
        headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }

        return connection
    }

    /**
     * Into a partial file beside the destination, renamed over it at the end. What a cut-off download left there
     * is asked for no more (Range, If-Range): a 206 continues it, anything else starts over, and a 416 (what's
     * there can't be continued) asks again for the whole file.
     */
    /** HttpURLConnection refuses PATCH, which tus uploads use: then the field it checks is set as it is. */
    private fun setMethod(connection: HttpURLConnection, method: String) {
        try {
            connection.requestMethod = method
        } catch (error: ProtocolException) {
            HttpURLConnection::class.java.getDeclaredField("method").apply { isAccessible = true }.set(connection, method)
        }
    }

    private fun download(
        registry: PluginRegistry,
        taskId: Long,
        transfer: Transfer,
        url: String,
        destination: File,
        headers: Map<String, String>,
        isRetry: Boolean = false,
    ): Map<String, Any> {
        val partial = PartialDownload(destination)
        val resumption = partial.resumption(url)
        val rangeHeaders = resumption?.let { mapOf("Range" to "bytes=${it.offset}-", "If-Range" to it.validator) }.orEmpty()
        val connection = open(transfer, url, "GET", headers + rangeHeaders)

        try {
            val status = connection.responseCode
            // The cache folder can be emptied meanwhile: the rest only goes after what was asked for.
            val hasLostWhatArrived = status == 206 && resumption != null && partial.file.length() != resumption.offset

            if ((status == 416 || hasLostWhatArrived) && !isRetry) {
                partial.discard()

                return download(registry, taskId, transfer, url, destination, headers, isRetry = true)
            }

            val resumes = status == 206 && resumption != null

            if (!resumes) partial.discard()
            partial.prepareFile()
            partial.remember(connection, url)

            val offset = partial.file.length()
            val contentLength = connection.contentLengthLong
            val progress = ProgressReporter(registry, taskId, if (contentLength < 0) -1 else offset + contentLength)

            // A 404's body is saved too, as fetch would hand it over.
            FileOutputStream(partial.file, true).use { output ->
                responseBody(connection, status).use { input -> copy(input, output, transfer, progress, startingAt = offset) }
            }
            partial.finish()
            // With its size known now, even when the server didn't say it.
            ProgressReporter(registry, taskId, destination.length()).report(destination.length(), isLast = true)

            return mapOf("uri" to Uri.fromFile(destination).toString(), "status" to status, "headers" to responseHeaders(connection))
        } catch (error: Exception) {
            // Kept for the next download to resume, unless canceled for good or the server can't resume it.
            if ((transfer.isCanceled && !transfer.keepsWhatArrived) || partial.resumption(url) == null) partial.discard()
            throw error
        } finally {
            connection.disconnect()
        }
    }

    private fun upload(
        registry: PluginRegistry,
        taskId: Long,
        transfer: Transfer,
        url: String,
        source: File,
        method: String,
        headers: Map<String, String>,
        form: Map<String, Any>?,
        range: LongRange,
    ): Map<String, Any> {
        val connection = open(transfer, url, method, headers)
        val boundary = "nativue-${UUID.randomUUID()}"
        val (head, tail) = form?.let { formParts(it, boundary) } ?: (ByteArray(0) to ByteArray(0))
        val length = range.last - range.first + 1
        val totalBytes = head.size + length + tail.size
        val progress = ProgressReporter(registry, taskId, totalBytes)

        try {
            connection.doOutput = true
            // Streamed as it's read, with its length known: no copy of the file in memory.
            connection.setFixedLengthStreamingMode(totalBytes)
            if (form != null) connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")

            connection.outputStream.use { output ->
                output.write(head)
                FileInputStream(source).use { input ->
                    input.channel.position(range.first)
                    copy(input, output, transfer, progress, startingAt = head.size.toLong(), limit = length)
                }
                output.write(tail)
            }
            progress.report(totalBytes, isLast = true)

            val status = connection.responseCode
            val body = responseBody(connection, status).use { it.readBytes().decodeToString() }

            return mapOf("status" to status, "headers" to responseHeaders(connection), "body" to body)
        } finally {
            connection.disconnect()
        }
    }

    /** The bytes to send, from offset: length of them, or to the end when it's -1. */
    private fun byteRange(source: File, offset: Long, length: Long): LongRange {
        if (!source.isFile) throw FileError("ERR_NOT_FOUND", "${source.path} doesn't exist")
        if (offset > source.length()) throw FileError("ERR_INVALID_ARGUMENT", "offset is past the end of the file")

        val end = if (length < 0) source.length() else minOf(source.length(), offset + length)

        return offset until end
    }

    private fun formParts(form: Map<String, Any>, boundary: String): Pair<ByteArray, ByteArray> {
        val head = StringBuilder()

        (form["fields"] as? Map<*, *>)?.forEach { (name, value) ->
            head.append("--$boundary\r\nContent-Disposition: form-data; name=\"${quoted(name.toString())}\"\r\n\r\n$value\r\n")
        }
        head.append("--$boundary\r\nContent-Disposition: form-data; name=\"${quoted(form["field"] as String)}\"; ")
        head.append("filename=\"${quoted(form["fileName"] as String)}\"\r\n")
        head.append("Content-Type: ${form["mimeType"]}\r\n\r\n")

        return head.toString().toByteArray() to "\r\n--$boundary--\r\n".toByteArray()
    }

    private fun quoted(value: String) = value.replace("\"", "%22").replace('\r', ' ').replace('\n', ' ')

    /** At most limit bytes, reporting the total from startingAt. */
    private fun copy(
        input: InputStream,
        output: OutputStream,
        transfer: Transfer,
        progress: ProgressReporter,
        startingAt: Long = 0,
        limit: Long = Long.MAX_VALUE,
    ) {
        val buffer = ByteArray(64 * 1024)
        var bytes = startingAt
        var remaining = limit

        while (remaining > 0) {
            if (transfer.isCanceled) throw IOException("Canceled")

            val read = input.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())

            if (read < 0) break
            output.write(buffer, 0, read)
            bytes += read
            remaining -= read
            progress.report(bytes)
        }
    }

    /** An error's body comes from errorStream, which is null when there's none. */
    private fun responseBody(connection: HttpURLConnection, status: Int): InputStream =
        connection.errorStream ?: if (status >= 400) ByteArrayInputStream(ByteArray(0)) else connection.inputStream

    private fun responseHeaders(connection: HttpURLConnection) = connection.headerFields
        .filterKeys { it != null }
        .mapKeys { (name, _) -> name.lowercase() }
        .mapValues { (_, values) -> values.joinToString(", ") }

    /** At most one progress event every PROGRESS_INTERVAL_MS, and the last one always. */
    private class ProgressReporter(val registry: PluginRegistry, val taskId: Long, val totalBytes: Long) {
        private var lastReport = 0L

        fun report(bytes: Long, isLast: Boolean = false) {
            val now = SystemClock.elapsedRealtime()

            if (!isLast && now - lastReport < PROGRESS_INTERVAL_MS) return

            lastReport = now
            registry.sendEvent("fileSystem.progress", mapOf("taskId" to taskId, "bytes" to bytes, "totalBytes" to totalBytes))
        }
    }

    private companion object {
        const val PROGRESS_INTERVAL_MS = 100L
        const val TIMEOUT_MS = 60_000
    }
}

/**
 * What a download has received so far, beside its destination, and what names the server's file (its ETag, or
 * else Last-Modified): the next download to the same place asks only for the rest, if the file hasn't changed.
 */
private class PartialDownload(val destination: File) {
    class Resumption(val offset: Long, val validator: String)

    val file = File(destination.parentFile, ".${destination.name}.partial")
    private val record = File(destination.parentFile, ".${destination.name}.partial.json")

    /** null when it can't resume: nothing here, another URL's, or no validator. */
    fun resumption(url: String): Resumption? {
        if (!record.isFile || file.length() == 0L) return null

        val saved = try {
            JSONObject(record.readText())
        } catch (error: JSONException) {
            return null
        }

        if (saved.optString("url") != url) return null

        return saved.optString("validator").takeIf { it.isNotEmpty() }?.let { Resumption(file.length(), it) }
    }

    fun remember(connection: HttpURLConnection, url: String) {
        val validator = connection.getHeaderField("ETag") ?: connection.getHeaderField("Last-Modified")

        if (validator == null) {
            record.delete()

            return
        }

        record.writeText(JSONObject(mapOf("url" to url, "validator" to validator)).toString())
    }

    fun prepareFile() {
        file.parentFile?.mkdirs()
        file.createNewFile()
    }

    fun finish() {
        if (destination.exists() && !destination.deleteRecursively()) throw IOException("Couldn't replace ${destination.path}")
        if (!file.renameTo(destination)) throw IOException("Couldn't save ${destination.path}")
        record.delete()
    }

    fun discard() {
        file.delete()
        record.delete()
    }
}
