package dev.nativue.location

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationManager
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import androidx.core.location.LocationListenerCompat
import androidx.core.location.LocationManagerCompat
import androidx.core.location.LocationRequestCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource

/** Where positions come from. Called on the main thread, with the permission already checked. */
internal interface Locator {
    /** null: no position before the timeout. */
    fun current(accuracy: String, timeoutMillis: Long, onResult: (Location?) -> Unit, onError: (String) -> Unit)

    fun lastKnown(onResult: (Location?) -> Unit)

    /** Returns what stops it. */
    fun watch(accuracy: String, distanceMeters: Float, intervalMillis: Long, onLocation: (Location) -> Unit): () -> Unit
}

/** Google Play services' fused provider: GPS, Wi-Fi and cell towers together, the least battery. */
@SuppressLint("MissingPermission")
internal class FusedLocator(context: Context) : Locator {
    private val client = LocationServices.getFusedLocationProviderClient(context)

    override fun current(accuracy: String, timeoutMillis: Long, onResult: (Location?) -> Unit, onError: (String) -> Unit) {
        val request = CurrentLocationRequest.Builder().setPriority(priority(accuracy)).setDurationMillis(timeoutMillis).build()

        client.getCurrentLocation(request, CancellationTokenSource().token)
            .addOnSuccessListener { onResult(it) }
            .addOnFailureListener { onError(it.message ?: "No position") }
    }

    override fun lastKnown(onResult: (Location?) -> Unit) {
        client.lastLocation.addOnSuccessListener { onResult(it) }.addOnFailureListener { onResult(null) }
    }

    override fun watch(accuracy: String, distanceMeters: Float, intervalMillis: Long, onLocation: (Location) -> Unit): () -> Unit {
        val request = LocationRequest.Builder(priority(accuracy), intervalMillis).setMinUpdateDistanceMeters(distanceMeters).build()
        val callback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.lastLocation?.let(onLocation)
            }
        }

        client.requestLocationUpdates(request, callback, Looper.getMainLooper())

        return { client.removeLocationUpdates(callback) }
    }

    private fun priority(accuracy: String) = when (accuracy) {
        "high" -> Priority.PRIORITY_HIGH_ACCURACY
        "low" -> Priority.PRIORITY_LOW_POWER
        else -> Priority.PRIORITY_BALANCED_POWER_ACCURACY
    }
}

/** The system's providers, on devices without Google Play services. */
@SuppressLint("MissingPermission")
internal class SystemLocator(private val context: Context) : Locator {
    private val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    private val mainThread = Handler(Looper.getMainLooper())

    override fun current(accuracy: String, timeoutMillis: Long, onResult: (Location?) -> Unit, onError: (String) -> Unit) {
        val provider = provider(accuracy) ?: return onError("No location provider is on")
        val cancellation = CancellationSignal()
        var hasAnswered = false
        val answer = { location: Location? ->
            if (!hasAnswered) {
                hasAnswered = true
                cancellation.cancel()
                onResult(location)
            }
        }

        mainThread.postDelayed({ answer(null) }, timeoutMillis)
        LocationManagerCompat.getCurrentLocation(manager, provider, cancellation, ContextCompat.getMainExecutor(context)) { answer(it) }
    }

    override fun lastKnown(onResult: (Location?) -> Unit) {
        onResult(manager.getProviders(true).mapNotNull { manager.getLastKnownLocation(it) }.maxByOrNull { it.time })
    }

    override fun watch(accuracy: String, distanceMeters: Float, intervalMillis: Long, onLocation: (Location) -> Unit): () -> Unit {
        val provider = provider(accuracy) ?: return {}
        val request = LocationRequestCompat.Builder(intervalMillis).setMinUpdateDistanceMeters(distanceMeters).build()
        val listener = LocationListenerCompat { onLocation(it) }

        LocationManagerCompat.requestLocationUpdates(manager, provider, request, ContextCompat.getMainExecutor(context), listener)

        return { LocationManagerCompat.removeUpdates(manager, listener) }
    }

    /** GPS for high accuracy, when the app may use it; else the network's, which is quicker and lighter. */
    private fun provider(accuracy: String): String? {
        val hasFine = ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_FINE_LOCATION) == 0
        val preferred = if (accuracy == "high" && hasFine) {
            listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
        } else {
            listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER)
        }

        return preferred.firstOrNull { manager.isProviderEnabled(it) && (it != LocationManager.GPS_PROVIDER || hasFine) }
    }
}
