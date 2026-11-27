package dev.nativue.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.Looper
import dev.nativue.NativuePlugin
import dev.nativue.PluginRegistry

/**
 * Network (src/index.ts): the default network, watched from the start. Turning Wi-Fi off loses it
 * before cellular takes over: offline is only reported when no network has come within a second.
 */
class NetworkPlugin : NativuePlugin {
    private lateinit var connectivityManager: ConnectivityManager
    private val mainThread = Handler(Looper.getMainLooper())
    private var latestState: Map<String, Any>? = null
    private var reportOffline: Runnable? = null

    override fun register(registry: PluginRegistry) {
        connectivityManager = registry.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        connectivityManager.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
                mainThread.post { report(registry, state(capabilities)) }
            }

            override fun onLost(network: Network) {
                mainThread.post {
                    reportOffline = Runnable { report(registry, OFFLINE) }.also {
                        mainThread.postDelayed(it, OFFLINE_DELAY_MS)
                    }
                }
            }
        })

        registry.addAsyncFunction("network.getState") { _, promise ->
            val capabilities = connectivityManager.activeNetwork?.let(connectivityManager::getNetworkCapabilities)

            promise.resolve(capabilities?.let(::state) ?: OFFLINE)
        }
    }

    /** On the main thread. Capabilities change often (signal strength, bandwidth): only a different state is sent. */
    private fun report(registry: PluginRegistry, state: Map<String, Any>) {
        reportOffline?.let(mainThread::removeCallbacks)
        reportOffline = null
        if (state == latestState) return

        latestState = state
        registry.sendEvent("network.change", state)
    }

    private fun state(capabilities: NetworkCapabilities) = mapOf(
        "isConnected" to true,
        "isInternetReachable" to (
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
            ),
        "type" to type(capabilities),
        "isExpensive" to !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED),
    )

    private fun type(capabilities: NetworkCapabilities) = when {
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
        else -> "other"
    }

    private companion object {
        const val OFFLINE_DELAY_MS = 1000L
        val OFFLINE = mapOf("isConnected" to false, "isInternetReachable" to false, "type" to "none", "isExpensive" to false)
    }
}
