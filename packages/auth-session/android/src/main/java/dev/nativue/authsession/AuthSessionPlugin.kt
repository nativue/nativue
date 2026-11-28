package dev.nativue.authsession

import android.app.Activity
import android.app.Application
import android.content.ActivityNotFoundException
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Base64
import androidx.activity.ComponentActivity
import androidx.browser.customtabs.CustomTabsIntent
import dev.nativue.ActivityListener
import dev.nativue.NativuePlugin
import dev.nativue.PluginRegistry
import dev.nativue.Promise
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * AuthSession (src/index.ts): the provider's page in a Custom Tab, the user's browser inside the app. The
 * redirect comes back as a link to the app's scheme, taken here before the router. The app coming back to
 * the front without it is the user closing the tab: a cancel. Android delivers a new link before the activity
 * resumes, so the order holds.
 */
class AuthSessionPlugin : NativuePlugin, ActivityListener {
    private lateinit var registry: PluginRegistry
    private val mainThread = Handler(Looper.getMainLooper())
    private val random = SecureRandom()
    /** On the main thread: the open sign-in, one at a time. */
    private var pending: Pending? = null
    private var isWatchingActivities = false

    private class Pending(val redirectUri: String, val promise: Promise) {
        /** The tab has shown: the app's next resume is the user coming back. */
        var hasLeftApp = false
    }

    override fun register(registry: PluginRegistry) {
        this.registry = registry
        // Called again for each new activity: the callbacks are registered once, for the whole process.
        if (!isWatchingActivities) {
            (registry.applicationContext as Application).registerActivityLifecycleCallbacks(activityWatcher)
            isWatchingActivities = true
        }

        registry.addAsyncFunction("authSession.open") { arguments, promise ->
            val url = arguments[0] as String
            val redirectUri = arguments[1] as String
            val ephemeral = arguments[2] as Boolean

            mainThread.post { open(url, redirectUri, ephemeral, promise) }
        }

        registry.addAsyncFunction("authSession.createPKCE") { _, promise ->
            val codeVerifier = randomString()
            val digest = MessageDigest.getInstance("SHA-256").digest(codeVerifier.toByteArray(Charsets.US_ASCII))

            promise.resolve(mapOf("codeVerifier" to codeVerifier, "codeChallenge" to base64URL(digest), "codeChallengeMethod" to "S256"))
        }

        registry.addAsyncFunction("authSession.randomString") { _, promise -> promise.resolve(randomString()) }
    }

    private fun open(url: String, redirectUri: String, ephemeral: Boolean, promise: Promise) {
        val activity = registry.activity

        if (pending != null) return promise.reject("ERR_UNAVAILABLE", "A sign-in is already open")
        if (activity == null) return promise.reject("ERR_UNAVAILABLE", "The app has no activity open")

        // Browsers without ephemeral tabs ignore it.
        val customTab = CustomTabsIntent.Builder().setEphemeralBrowsingEnabled(ephemeral).build()

        pending = Pending(redirectUri, promise)
        try {
            customTab.launchUrl(activity, Uri.parse(url))
        } catch (error: ActivityNotFoundException) {
            pending = null
            promise.reject("ERR_UNAVAILABLE", "There's no browser to sign in with")
        } catch (error: Exception) {
            pending = null
            promise.reject("ERR_UNAVAILABLE", error.message ?: "The sign-in couldn't open")
        }
    }

    // Its JavaScript goes with it: the redirect then reaches the new one's onOpenURL, as a link.
    override fun onActivityDestroyed(activity: ComponentActivity) {
        pending = null
    }

    // The redirect, before the router sees it.
    override fun open(url: String): Boolean {
        val current = pending ?: return false

        if (!isRedirect(url, current.redirectUri)) return false

        pending = null
        current.promise.resolve(mapOf("type" to "success", "url" to url))

        return true
    }

    private val activityWatcher = object : Application.ActivityLifecycleCallbacks {
        override fun onActivityPaused(activity: Activity) {
            pending?.hasLeftApp = true
        }

        override fun onActivityResumed(activity: Activity) {
            val current = pending?.takeIf { it.hasLeftApp } ?: return

            pending = null
            current.promise.resolve(mapOf("type" to "cancel"))
        }

        override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}

        override fun onActivityStarted(activity: Activity) {}

        override fun onActivityStopped(activity: Activity) {}

        override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}

        override fun onActivityDestroyed(activity: Activity) {}
    }

    /**
     * myapp://oauth/?code=… is a redirect to myapp://oauth: the same scheme and host, in any case, and path,
     * with or without a trailing slash. Other links to the app go on to the router.
     */
    private fun isRedirect(url: String, redirectUri: String): Boolean {
        val (link, redirect) = Uri.parse(url) to Uri.parse(redirectUri)

        return link.scheme.equals(redirect.scheme, ignoreCase = true) &&
            link.host.orEmpty().equals(redirect.host.orEmpty(), ignoreCase = true) &&
            link.path.orEmpty().trimEnd('/') == redirect.path.orEmpty().trimEnd('/')
    }

    /** 32 random bytes from the system's secure generator, base64url: 43 characters, as PKCE asks. */
    private fun randomString(): String = base64URL(ByteArray(32).also(random::nextBytes))

    private fun base64URL(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
}
