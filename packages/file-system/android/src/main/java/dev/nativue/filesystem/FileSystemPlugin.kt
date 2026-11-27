package dev.nativue.filesystem

import android.net.Uri
import android.os.SystemClock
import android.util.Base64
import dev.nativue.NativuePlugin
import dev.nativue.PluginRegistry
import dev.nativue.Promise
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * FileSystem (src/index.ts): files under file:// URIs, and downloads and uploads that report their progress
 * as fileSystem.progress. Files go one at a time on a worker thread; each transfer gets a thread of its own.
 */
class FileSystemPlugin : NativuePlugin {
    private val fileWorker = Executors.newSingleThreadExecutor()
    private val transferWorkers = Executors.newCachedThreadPool()
    private val runningTransfers = ConcurrentHashMap<Int, Transfer>()

    private class Transfer {
        @Volatile var isCanceled = false
        @Volatile var connection: HttpURLConnection? = null

        fun cancel() {
            isCanceled = true
            connection?.disconnect()
        }
    }

    override fun register(registry: PluginRegistry) {
        // A new activity is a new JavaScript runtime: the old one's transfers have no one left to answer.
        runningTransfers.values.forEach(Transfer::cancel)

        registry.addFunction("fileSystem.paths") { _ ->
            mapOf(
                "document" to directoryUri(registry.applicationContext.filesDir),
                "cache" to directoryUri(registry.applicationContext.cacheDir),
            )
        }

        addFileFunction(registry, "fileSystem.readText") { arguments -> file(arguments[0]).readText() }
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

            if (!source.exists()) throw FileNotFoundException("${source.path} doesn't exist")
            prepare(destination)
            if (!source.copyRecursively(destination)) throw IOException("Couldn't copy ${source.path}")
            null
        }
        addFileFunction(registry, "fileSystem.move") { arguments ->
            val (source, destination) = file(arguments[0]) to file(arguments[1])

            if (!source.exists()) throw FileNotFoundException("${source.path} doesn't exist")
            prepare(destination)
            // Across filesystems a rename fails: then it's a copy and a delete.
            if (!source.renameTo(destination)) {
                source.copyRecursively(destination)
                source.deleteRecursively()
            }
            null
        }

        registry.addAsyncFunction("fileSystem.download") { arguments, promise ->
            val taskId = (arguments[0] as Number).toInt()

            transfer(taskId, promise) { transfer ->
                download(registry, taskId, transfer, arguments[1] as String, file(arguments[2]), headers(arguments[3]))
            }
        }

        registry.addAsyncFunction("fileSystem.upload") { arguments, promise ->
            val taskId = (arguments[0] as Number).toInt()

            transfer(taskId, promise) { transfer ->
                @Suppress("UNCHECKED_CAST")
                upload(
                    registry, taskId, transfer, arguments[1] as String, file(arguments[2]),
                    method = arguments[3] as String,
                    headers = headers(arguments[4]),
                    form = arguments[5] as Map<String, Any>?,
                )
            }
        }

        registry.addFunction("fileSystem.cancel") { arguments ->
            runningTransfers[(arguments[0] as Number).toInt()]?.cancel()
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

    private fun transfer(taskId: Int, promise: Promise, work: (Transfer) -> Map<String, Any>) {
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
        connection.requestMethod = method
        headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }

        return connection
    }

    private fun download(
        registry: PluginRegistry,
        taskId: Int,
        transfer: Transfer,
        url: String,
        destination: File,
        headers: Map<String, String>,
    ): Map<String, Any> {
        val connection = open(transfer, url, "GET", headers)

        try {
            val status = connection.responseCode
            val totalBytes = connection.contentLengthLong
            val progress = ProgressReporter(registry, taskId, totalBytes)

            destination.parentFile?.mkdirs()
            writeAtomically(destination) { output ->
                // A 404's body is saved too, as fetch would hand it over.
                responseBody(connection, status).use { input -> copy(input, output, transfer, progress) }
            }
            progress.report(destination.length(), isLast = true)

            return mapOf("uri" to Uri.fromFile(destination).toString(), "status" to status, "headers" to responseHeaders(connection))
        } finally {
            connection.disconnect()
        }
    }

    private fun upload(
        registry: PluginRegistry,
        taskId: Int,
        transfer: Transfer,
        url: String,
        source: File,
        method: String,
        headers: Map<String, String>,
        form: Map<String, Any>?,
    ): Map<String, Any> {
        if (!source.isFile) throw FileError("ERR_NOT_FOUND", "${source.path} doesn't exist")

        val connection = open(transfer, url, method, headers)
        val boundary = "nativue-${UUID.randomUUID()}"
        val (head, tail) = form?.let { formParts(it, boundary) } ?: (ByteArray(0) to ByteArray(0))
        val totalBytes = head.size + source.length() + tail.size
        val progress = ProgressReporter(registry, taskId, totalBytes)

        try {
            connection.doOutput = true
            // Streamed as it's read, with its length known: no copy of the file in memory.
            connection.setFixedLengthStreamingMode(totalBytes)
            if (form != null) connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")

            connection.outputStream.use { output ->
                output.write(head)
                source.inputStream().use { input -> copy(input, output, transfer, progress, startingAt = head.size.toLong()) }
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

    private fun quoted(value: String) = value.replace("\"", "%22").replace("\r\n", " ")

    private fun copy(input: InputStream, output: OutputStream, transfer: Transfer, progress: ProgressReporter, startingAt: Long = 0) {
        val buffer = ByteArray(64 * 1024)
        var bytes = startingAt

        while (true) {
            if (transfer.isCanceled) throw IOException("Canceled")

            val read = input.read(buffer)

            if (read < 0) break
            output.write(buffer, 0, read)
            bytes += read
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
    private class ProgressReporter(val registry: PluginRegistry, val taskId: Int, val totalBytes: Long) {
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
    }
}
