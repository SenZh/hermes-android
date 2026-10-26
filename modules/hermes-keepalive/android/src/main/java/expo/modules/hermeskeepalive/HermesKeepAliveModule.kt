package expo.modules.hermeskeepalive

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HermesKeepAliveModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }

  private val handler = Handler(Looper.getMainLooper())

  /**
   * Fires when a posted start has still not reached RUNNING.
   *
   * It deliberately does NOT stop the service. Android's requirement is "startForeground() must
   * follow startForegroundService()"; calling stopService while that requirement is pending is the
   * same violation, only earlier. So the watchdog only records the miss and lets JS back off.
   */
  private val watchdog = Runnable {
    if (KeepAliveService.state == ServiceState.STARTING) {
      KeepAliveService.state = ServiceState.UNCONFIRMED
      KeepAliveService.lastStartMissedAt = System.currentTimeMillis()
    }
  }

  override fun definition() = ModuleDefinition {
    Name("HermesKeepAlive")

    OnCreate {
      CrashReporter.install(context)
    }

    /** Last unacknowledged crash/ANR as a map, or null. */
    Function("lastExit") { CrashReporter.lastExit(context) }

    /** Mark the last crash report as seen. */
    Function("acknowledgeExit") { CrashReporter.acknowledge(context) }

    /** Why the last foreground promotion failed, or null when it succeeded. */
    Function("lastStartError") { KeepAliveService.lastStartError }

    /** Start (or refresh) the foreground service. Returns false when Android refused it. */
    Function("start") { title: String, text: String ->
      val intent = Intent(context, KeepAliveService::class.java)
        .putExtra(KeepAliveService.EXTRA_TITLE, title)
        .putExtra(KeepAliveService.EXTRA_TEXT, text)

      // Pre-flight before posting anything. Not posting means Android books nothing, so no
      // foreground requirement is left dangling — the only fully reliable way out of the crash.
      if (!KeepAliveService.ensureChannelReady(context)) return@Function false

      try {
        KeepAliveService.state = ServiceState.STARTING
        ContextCompat.startForegroundService(context, intent)
        handler.removeCallbacks(watchdog)
        handler.postDelayed(watchdog, WATCHDOG_MS)
        true
      } catch (e: Exception) {
        // ForegroundServiceStartNotAllowedException and friends: the app is not in the foreground.
        // startForegroundService() threw, so nothing was booked either.
        KeepAliveService.state = ServiceState.IDLE
        KeepAliveService.lastStartError = "post_refused:${e.javaClass.simpleName}"
        false
      }
    }

    /** Change the notification text without restarting the service. False when the service is gone. */
    Function("update") { title: String, text: String ->
      when (KeepAliveService.state) {
        // Only IDLE means "the service is really gone". Reporting false for STARTING/UNCONFIRMED
        // would make JS stop the service while a foreground promotion is still pending — the exact
        // violation this module exists to prevent.
        ServiceState.IDLE -> return@Function false
        // Not promoted yet: the notification will be posted by onStartCommand's startForeground.
        ServiceState.STARTING -> return@Function true
        else -> Unit
      }
      KeepAliveService.ensureChannelReady(context)
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.notify(KeepAliveService.notificationId(), KeepAliveService.build(context, title, text))
      true
    }

    Function("stop") {
      handler.removeCallbacks(watchdog)
      // A stop landing while the start is still in flight would be the crash path itself. Hand the
      // request to the service, which performs it right after the foreground promotion. UNCONFIRMED
      // counts too: the system may still be inside its promotion window.
      if (KeepAliveService.state == ServiceState.STARTING || KeepAliveService.state == ServiceState.UNCONFIRMED) {
        KeepAliveService.requestStop()
        return@Function
      }
      context.stopService(Intent(context, KeepAliveService::class.java))
    }

    OnDestroy {
      // No stopService here: this fires on React Native context teardown, and a stop landing while
      // a start is still pending is the exact shape of the crash this module guards against.
      handler.removeCallbacks(watchdog)
      if (KeepAliveService.state == ServiceState.UNCONFIRMED) KeepAliveService.state = ServiceState.IDLE
    }
  }

  private companion object {
    /** Shorter than Android's own window, so a miss is noticed before the system kills us. */
    const val WATCHDOG_MS = 4000L
  }
}
