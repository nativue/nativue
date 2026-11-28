package dev.nativue.location

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts.StartIntentSenderForResult
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.api.ResolvableApiException
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.LocationSettingsRequest
import com.google.android.gms.location.Priority
import dev.nativue.ActivityListener
import dev.nativue.NativuePlugin
import dev.nativue.PluginRegistry
import dev.nativue.Promise

/**
 * Location (src/index.ts): the fused provider of Google Play services, or the system's providers on devices
 * without them. Calls run on the main thread, where the providers report.
 */
class LocationPlugin : NativuePlugin, ActivityListener {
    private lateinit var registry: PluginRegistry
    private val mainThread = Handler(Looper.getMainLooper())
    private val locator: Locator by lazy {
        val context = registry.applicationContext
        val hasPlayServices = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS

        if (hasPlayServices) FusedLocator(context) else SystemLocator(context)
    }
    /** What stops each watch, by the id JavaScript gave it. */
    private val watches = mutableMapOf<Int, () -> Unit>()
    private var enableServicesLauncher: ActivityResultLauncher<IntentSenderRequest>? = null
    private var waitingForServices: Promise? = null

    override fun register(registry: PluginRegistry) {
        this.registry = registry
        // Called again for each new JavaScript runtime: the old one's watches have no one to report to.
        mainThread.post {
            watches.values.forEach { stop -> stop() }
            watches.clear()
        }

        addFunction("location.getPermission") { _, promise -> promise.resolve(permission()) }

        addFunction("location.requestPermission") { arguments, promise -> requestPermission(arguments[0] as Boolean, promise) }

        addFunction("location.getCurrentPosition") { arguments, promise ->
            val accuracy = arguments[0] as String
            val timeout = (arguments[1] as Number).toLong()

            ifCanLocate(promise) {
                locator.current(
                    accuracy,
                    timeout,
                    onResult = { location ->
                        if (location != null) promise.resolve(position(location))
                        else promise.reject("ERR_TIMEOUT", "No position within the timeout")
                    },
                    onError = { message -> promise.reject("ERR_UNAVAILABLE", message) },
                )
            }
        }

        addFunction("location.getLastKnownPosition") { _, promise ->
            if (!hasPermission(COARSE)) return@addFunction promise.resolve(null)

            locator.lastKnown { location -> promise.resolve(location?.let(::position)) }
        }

        addFunction("location.hasServicesEnabled") { _, promise -> promise.resolve(servicesEnabled()) }

        addFunction("location.enableServices") { _, promise -> enableServices(promise) }

        addFunction("location.startWatching") { arguments, promise ->
            val watchId = (arguments[0] as Number).toInt()
            val options = arguments[1] as Map<*, *>

            ifCanLocate(promise) {
                watches.remove(watchId)?.invoke()
                watches[watchId] = locator.watch(
                    options["accuracy"] as String,
                    (options["distanceInterval"] as Number).toFloat(),
                    (options["timeInterval"] as Number).toLong(),
                ) { location -> registry.sendEvent("location.watch", mapOf("watchId" to watchId, "position" to position(location))) }
                promise.resolve(null)
            }
        }

        addFunction("location.stopWatching") { arguments, promise ->
            watches.remove((arguments[0] as Number).toInt())?.invoke()
            promise.resolve(null)
        }
    }

    override fun onActivityCreated(activity: ComponentActivity) {
        enableServicesLauncher = activity.registerForActivityResult(StartIntentSenderForResult()) {
            waitingForServices?.resolve(servicesEnabled())
            waitingForServices = null
        }
    }

    private fun addFunction(name: String, function: (List<Any?>, Promise) -> Unit) {
        registry.addAsyncFunction(name) { arguments, promise -> mainThread.post { function(arguments, promise) } }
    }

    private fun permission(): Map<String, Any> {
        val response = registry.permissions.status(COARSE)

        if (response["granted"] != true) return response

        val isAlways = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || hasPermission(BACKGROUND)

        return response + mapOf(
            "accuracy" to if (hasPermission(FINE)) "precise" else "approximate",
            "scope" to if (isAlways) "always" else "whenInUse",
        )
    }

    /** Fine and coarse together: Android 12+ lets the user pick approximate. Always is asked after, on its own. */
    private fun requestPermission(background: Boolean, promise: Promise) {
        if (background && !declares(BACKGROUND.first())) {
            return promise.reject(
                "ERR_INVALID_ARGUMENT",
                "Asking for the location all the time needs location({ background: true }) in nativue.config.ts",
            )
        }

        registry.permissions.request(FINE + COARSE) { response ->
            val asksAlways = background && response["granted"] == true && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q

            if (asksAlways) registry.permissions.request(BACKGROUND) { promise.resolve(permission()) }
            else promise.resolve(permission())
        }
    }

    private fun ifCanLocate(promise: Promise, locate: () -> Unit) {
        when {
            !hasPermission(COARSE) -> promise.reject("ERR_PERMISSION_DENIED", "No location permission: ask with requestPermission() first")
            !servicesEnabled() -> promise.reject("ERR_UNAVAILABLE", "Location is turned off on the device")
            else -> locate()
        }
    }

    /** Google Play services' dialog, which turns location on in place. Without them, there's no dialog to show. */
    private fun enableServices(promise: Promise) {
        val activity = registry.activity
        val launcher = enableServicesLauncher

        if (servicesEnabled() || activity == null || launcher == null || locator !is FusedLocator) {
            return promise.resolve(servicesEnabled())
        }

        val request = LocationSettingsRequest.Builder()
            .addLocationRequest(LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, 10_000).build())
            .build()

        LocationServices.getSettingsClient(activity).checkLocationSettings(request)
            .addOnSuccessListener { promise.resolve(servicesEnabled()) }
            .addOnFailureListener { error ->
                if (error !is ResolvableApiException || waitingForServices != null) return@addOnFailureListener promise.resolve(servicesEnabled())

                waitingForServices = promise
                launcher.launch(IntentSenderRequest.Builder(error.resolution).build())
            }
    }

    private fun servicesEnabled(): Boolean {
        val manager = registry.applicationContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager

        return LocationManagerCompat.isLocationEnabled(manager)
    }

    private fun hasPermission(permissions: List<String>) =
        permissions.all { ContextCompat.checkSelfPermission(registry.applicationContext, it) == PackageManager.PERMISSION_GRANTED }

    private fun declares(permission: String): Boolean {
        val context = registry.applicationContext
        val packageInfo = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS)

        return packageInfo.requestedPermissions?.contains(permission) == true
    }

    /** Fields the provider didn't measure are null, as on the web. */
    private fun position(location: Location): Map<String, Any?> {
        val hasVerticalAccuracy = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && location.hasVerticalAccuracy()

        return mapOf(
            "coords" to mapOf(
                "latitude" to location.latitude,
                "longitude" to location.longitude,
                "accuracy" to location.accuracy.toDouble(),
                "altitude" to if (location.hasAltitude()) location.altitude else null,
                "altitudeAccuracy" to if (hasVerticalAccuracy) location.verticalAccuracyMeters.toDouble() else null,
                "heading" to if (location.hasBearing()) location.bearing.toDouble() else null,
                "speed" to if (location.hasSpeed()) location.speed.toDouble() else null,
            ),
            "timestamp" to location.time.toDouble(),
        )
    }

    private companion object {
        val FINE = listOf(Manifest.permission.ACCESS_FINE_LOCATION)
        val COARSE = listOf(Manifest.permission.ACCESS_COARSE_LOCATION)
        val BACKGROUND = listOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
    }
}
