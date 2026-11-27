package dev.nativue.securestore

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import dev.nativue.NativuePlugin
import dev.nativue.PluginRegistry
import dev.nativue.Promise
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.util.concurrent.Executors
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * SecureStore (src/index.ts): values encrypted with an AES key of the Android Keystore, which never leaves
 * the device, and kept in the app's SharedPreferences.
 */
class SecureStorePlugin : NativuePlugin {
    // One at a time, in order: a setItem then a getItem read what was set.
    private val worker = Executors.newSingleThreadExecutor()

    override fun register(registry: PluginRegistry) {
        val preferences by lazy { registry.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE) }

        registry.addAsyncFunction("secureStore.setItem") { arguments, promise ->
            inBackground(promise) {
                preferences.edit().putString(arguments[0] as String, encrypt(arguments[1] as String)).commit()
                null
            }
        }

        registry.addAsyncFunction("secureStore.getItem") { arguments, promise ->
            inBackground(promise) {
                val key = arguments[0] as String
                val stored = preferences.getString(key, null)

                stored?.let { decryptOrForget(it) { preferences.edit().remove(key).commit() } }
            }
        }

        registry.addAsyncFunction("secureStore.deleteItem") { arguments, promise ->
            inBackground(promise) {
                preferences.edit().remove(arguments[0] as String).commit()
                null
            }
        }
    }

    private fun inBackground(promise: Promise, work: () -> Any?) {
        worker.execute {
            try {
                promise.resolve(work())
            } catch (error: GeneralSecurityException) {
                promise.reject("ERR_UNAVAILABLE", error.message ?: "The Android Keystore failed")
            }
        }
    }

    /** Base64 of the IV, then the ciphertext and its tag. */
    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key()) }

        return Base64.encodeToString(cipher.iv + cipher.doFinal(value.toByteArray()), Base64.NO_WRAP)
    }

    /**
     * A value its key can't open (restored from a backup onto another device, whose Keystore doesn't have
     * the key) reads as none, and is forgotten.
     */
    private fun decryptOrForget(stored: String, forget: () -> Unit): String? = try {
        val bytes = Base64.decode(stored, Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORMATION).apply {
            init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, bytes, 0, IV_BYTES))
        }

        String(cipher.doFinal(bytes, IV_BYTES, bytes.size - IV_BYTES))
    } catch (error: Exception) {
        forget()
        null
    }

    private fun key(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }

        val specification = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()

        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE).run {
            init(specification)
            generateKey()
        }
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "nativue.secure-store"
        const val PREFERENCES = "nativue.secure-store"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
        const val TAG_BITS = 128
    }
}
