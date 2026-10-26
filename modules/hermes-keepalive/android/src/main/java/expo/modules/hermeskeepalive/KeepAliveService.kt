package expo.modules.hermeskeepalive

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Foreground service that exists only while the agent is working (or waiting for the user) and the
 * app may be in the background. Its job is to keep the process, and with it the gateway WebSocket,
 * from being frozen or killed, so "turn finished" and approval notifications still arrive.
 *
 * IRON RULE: Android books every `startForegroundService()` call and demands a matching
 * `startForeground()` within a few seconds. Stopping the service before that promotion is the same
 * violation as never promoting it — the pending requirement outlives the stop and the system kills
 * the process with ForegroundServiceDidNotStartInTimeException. So nothing here may call
 * `stopSelf()` / `stopService()` before `startForeground()` has succeeded for the latest start.
 */
enum class ServiceState {
  IDLE,
  STARTING,
  RUNNING,

  /**
   * Posted and not yet confirmed as foreground after the watchdog window. Reporting only: it never
   * drives a stop, because stopping here is exactly the violation described above.
   */
  UNCONFIRMED,
}

class KeepAliveService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Hermes is working"
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: ""

    // Promote first, unconditionally. Everything above this point is pure in-memory work.
    try {
      ServiceCompat.startForeground(this, NOTIFICATION_ID, build(this, title, text), foregroundType())
      state = ServiceState.RUNNING
      lastStartError = null
      // A stop arrived while this start was still in flight. Now that the promotion exists,
      // stopping is legal — doing it earlier is exactly the crash this class guards against.
      if (stopRequested) {
        clearStopRequest()
        stopSelf()
      }
      return START_NOT_STICKY
    } catch (first: Exception) {
      // Typical cause: the notification handed over was rejected (channel gone, bad icon).
      // Do NOT stopSelf here — that turns "not yet foreground" into a permanent violation.
      // Retry once with a notification that depends on nothing but framework resources.
      try {
        ServiceCompat.startForeground(this, NOTIFICATION_ID, fallbackNotification(this), foregroundType())
        state = ServiceState.RUNNING
        lastStartError = "primary_rejected_fallback_ok:${first.javaClass.simpleName}"
        return START_NOT_STICKY
      } catch (second: Exception) {
        // Two rejections means the system will not accept any foreground notification from us.
        // Every remaining action is then a violation; stopping is the least-bad one.
        lastStartError = "both_rejected:${second.javaClass.simpleName}"
        state = ServiceState.IDLE
        clearStopRequest()
        stopSelf()
        return START_NOT_STICKY
      }
    }
  }

  override fun onDestroy() {
    // Drop the ongoing notification so it cannot outlive the service it belongs to.
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    state = ServiceState.IDLE
    clearStopRequest()
    super.onDestroy()
  }

  /** Android 15 caps dataSync services at six hours a day; bow out cleanly when told to. */
  override fun onTimeout(startId: Int, fgsType: Int) {
    stopOrDefer()
  }

  @Deprecated("Superseded by the two-argument overload on Android 15")
  override fun onTimeout(startId: Int) {
    stopOrDefer()
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // The user swiped the app away: stop rather than keep an orphaned notification.
    stopOrDefer()
    super.onTaskRemoved(rootIntent)
  }

  /**
   * Stop now if we are already foreground, otherwise defer: stopping before the promotion is the
   * crash path, so the request waits for onStartCommand to promote us.
   */
  private fun stopOrDefer() {
    if (state == ServiceState.RUNNING) {
      stopSelf()
    } else {
      requestStop()
    }
  }

  companion object {
    /**
     * Owned by the service, read by the module: the module's start() marks STARTING, a successful
     * onStartCommand marks RUNNING, and every way the service ends funnels through onDestroy → IDLE.
     * Without this the module kept posting updates for a service that was already gone, leaving an
     * orphaned ongoing notification.
     */
    @Volatile
    var state: ServiceState = ServiceState.IDLE

    /** Last foreground-promotion failure, for diagnostics. Null when the last start succeeded. */
    @Volatile
    var lastStartError: String? = null

    /** When the watchdog last observed a posted start that never reached RUNNING. */
    @Volatile
    var lastStartMissedAt: Long = 0L

    /**
     * A stop asked for while a start was still in flight. The service performs it itself once the
     * foreground promotion exists, because stopping before that is the crash path.
     *
     * Stored as a timestamp rather than a boolean so the flag cannot go stale: JS and the service
     * run on different threads, and a plain "set true / read-and-clear" pair would be a check-then-act
     * race. A stop older than [STOP_REQUEST_TTL_MS] is simply ignored.
     */
    @Volatile
    private var stopRequestedAt: Long = 0L

    private const val STOP_REQUEST_TTL_MS = 10_000L

    /** True when a stop was requested and is still fresh. */
    val stopRequested: Boolean
      get() {
        val at = stopRequestedAt
        return at > 0 && System.currentTimeMillis() - at < STOP_REQUEST_TTL_MS
      }

    fun requestStop() {
      stopRequestedAt = System.currentTimeMillis()
    }

    fun clearStopRequest() {
      stopRequestedAt = 0L
    }

    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    private const val CHANNEL_ID = "hermes-working"
    private const val NOTIFICATION_ID = 9119

    fun foregroundType(): Int =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0

    /**
     * Creates the channel if needed and reports whether it is actually usable.
     *
     * This is the single gate every start must pass before posting: once a start is posted, a
     * rejected notification can crash the process through a path the service cannot catch, so the
     * only reliable defence is to never post when the notification cannot be built.
     */
    fun ensureChannelReady(context: Context): Boolean {
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
          if (manager.getNotificationChannel(CHANNEL_ID) == null) {
            val channel = NotificationChannel(
              CHANNEL_ID,
              "Agent at work",
              NotificationManager.IMPORTANCE_LOW,
            ).apply {
              description = "Shown while Hermes works on a turn so the connection stays open in the background."
              setShowBadge(false)
            }
            manager.createNotificationChannel(channel)
          }
          return manager.getNotificationChannel(CHANNEL_ID) != null
        }
        return true
      } catch (e: Exception) {
        lastStartError = "channel_unavailable:${e.javaClass.simpleName}"
        return false
      }
    }

    fun build(context: Context, title: String, text: String): Notification {
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
        flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      }
      val content = launch?.let {
        PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      }
      return NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_stat_hermes)
        .setContentTitle(title)
        .setContentText(text)
        .setContentIntent(content)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setCategory(NotificationCompat.CATEGORY_PROGRESS)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        .setProgress(0, 0, true)
        .build()
    }

    /**
     * Last-resort notification: no app resources, no custom icon, no content intent. Only used when
     * the normal notification was rejected, so it must depend on nothing that could itself fail.
     */
    fun fallbackNotification(context: Context): Notification =
      NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.stat_sys_download)
        .setContentTitle("Hermes")
        .setContentText("Working")
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .build()

    fun notificationId() = NOTIFICATION_ID
  }
}
