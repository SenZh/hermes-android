package expo.modules.hermeskeepalive

import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.DocumentsContract
import android.provider.Settings
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale

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
      val deferred = KeepAliveService.state == ServiceState.STARTING ||
        KeepAliveService.state == ServiceState.UNCONFIRMED
      if (deferred) {
        KeepAliveService.requestStop()
      } else {
        context.stopService(Intent(context, KeepAliveService::class.java))
      }
    }

    OnDestroy {
      // No stopService here: this fires on React Native context teardown, and a stop landing while
      // a start is still pending is the exact shape of the crash this module guards against.
      handler.removeCallbacks(watchdog)
      if (KeepAliveService.state == ServiceState.UNCONFIRMED) KeepAliveService.state = ServiceState.IDLE
    }

    /**
     * Open a content:// or file:// URI with the system's default viewer or installer.
     * Uses FLAG_GRANT_READ_URI_PERMISSION so external apps can read SAF documents.
     */
    Function("openFile") { uriString: String, mimeType: String? ->
      val uri = Uri.parse(uriString)
      val type = if (!mimeType.isNullOrBlank()) {
        mimeType
      } else {
        context.contentResolver.getType(uri) ?: "*/*"
      }
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, type)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      try {
        context.startActivity(intent)
      } catch (_: Exception) {
        val chooser = Intent.createChooser(intent, "Open").apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(chooser)
      }
      true
    }

    /**
     * Open a folder (SAF tree URI) in the system file manager.
     *
     * Vendors replace DocumentsUI with their own file manager, and a plain ACTION_VIEW with
     * MIME_TYPE_DIR is simply not answered on some of them — the click would silently do nothing.
     * So walk a four-step ladder and stop at the first one that actually resolves.
     */
    Function("openFolder") { dirUriString: String ->
      val uri = Uri.parse(dirUriString)
      val docUri = try {
        if (DocumentsContract.isTreeUri(uri)) {
          DocumentsContract.buildDocumentUriUsingTree(uri, DocumentsContract.getTreeDocumentId(uri))
        } else {
          uri
        }
      } catch (_: Exception) {
        uri
      }

      fun attempt(intent: Intent): Boolean = try {
        context.startActivity(intent)
        true
      } catch (_: Exception) {
        false
      }

      val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK

      // L1: implicit. MIME_TYPE_DIR keeps unrelated apps (browsers, Google) out of the chooser.
      if (attempt(Intent(Intent.ACTION_VIEW).apply {
          setDataAndType(docUri, DocumentsContract.Document.MIME_TYPE_DIR)
          addFlags(flags)
        })
      ) return@Function true

      // L2: explicit DocumentsUI. FilesActivity reads the landing folder from getData(),
      // NOT from EXTRA_INITIAL_URI — that extra only applies to OPEN_DOCUMENT* actions.
      // Passing it here would open the Files home page while still reporting success,
      // which would short-circuit the vendor fallbacks below.
      if (attempt(Intent(Intent.ACTION_VIEW).apply {
          component = ComponentName("com.android.documentsui", "com.android.documentsui.files.FilesActivity")
          data = docUri
          addFlags(flags)
        })
      ) return@Function true

      // L3: vendor file managers. Names change between ROM versions, so probe before trusting.
      val vendorBrowsers = listOf(
        ComponentName("com.android.fileexplorer", "com.android.fileexplorer.FileExplorerTabActivity"),
        ComponentName("com.miui.fileexplorer", "com.miui.fileexplorer.FileExplorerTabActivity"),
        ComponentName("com.huawei.hidisk", "com.huawei.hidisk.filemanager.FileManager"),
        ComponentName("com.coloros.filemanager", "com.coloros.filemanager.filerecycler.FileManagerActivity"),
        ComponentName("com.vivo.filemanager", "com.vivo.filemanager.FileManagerActivity"),
      )
      for (target in vendorBrowsers) {
        if (context.packageManager.resolveActivity(Intent(Intent.ACTION_VIEW).setComponent(target), 0) == null) {
          continue
        }
        if (attempt(Intent(Intent.ACTION_VIEW).apply {
            component = target
            putExtra(DocumentsContract.EXTRA_INITIAL_URI, docUri)
            addFlags(flags)
          })
        ) return@Function true
      }

      // L4: last resort. Costs the user one extra tap but always reaches the folder.
      attempt(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
        putExtra(DocumentsContract.EXTRA_INITIAL_URI, docUri)
        addFlags(flags)
      })
    }

    /**
     * Whether this app is exempt from Doze/battery optimisation.
     *
     * This is the only vendor-related switch with a real query API. Auto-start cannot be read or
     * written at all — for that the UI can only guide the user to the right settings screen.
     */
    Function("batteryOptimizationIgnored") {
      val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      power.isIgnoringBatteryOptimizations(context.packageName)
    }

    /** Ask for the Doze whitelist; the system shows its own confirmation dialog. */
    Function("requestBatteryExemption") {
      try {
        context.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
          data = Uri.parse("package:${context.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        })
        true
      } catch (_: Exception) {
        false
      }
    }

    /**
     * Jump to the vendor's auto-start management screen.
     *
     * There is no public API to read or change this switch, so all we can do is land the user on
     * the right page. Component names differ per ROM and change between versions, hence the
     * resolve probe plus a fallback to the app details screen.
     */
    Function("openAutoStartSettings") {
      val manufacturer = Build.MANUFACTURER.lowercase(Locale.ROOT)
      val intent = Intent().addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

      when {
        manufacturer.contains("xiaomi") || manufacturer.contains("redmi") || manufacturer.contains("poco") ->
          intent.component = ComponentName(
            "com.miui.securitycenter",
            "com.miui.permcenter.autostart.AutoStartManagementActivity",
          )
        manufacturer.contains("huawei") || manufacturer.contains("honor") ->
          intent.component = ComponentName(
            "com.huawei.systemmanager",
            "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
          )
        manufacturer.contains("oppo") || manufacturer.contains("realme") || manufacturer.contains("oneplus") ->
          intent.component = ComponentName(
            "com.coloros.safecenter",
            "com.coloros.safecenter.permission.startup.StartupAppListActivity",
          )
        manufacturer.contains("vivo") || manufacturer.contains("iqoo") ->
          intent.component = ComponentName(
            "com.vivo.permissionmanager",
            "com.vivo.permissionmanager.activity.BgStartUpManagerActivity",
          )
        manufacturer.contains("samsung") ->
          intent.component = ComponentName(
            "com.samsung.android.sm",
            "com.samsung.android.sm.app.dashboard.SmartManagerDashBoardActivity",
          )
        else -> {
          intent.action = Settings.ACTION_APPLICATION_DETAILS_SETTINGS
          intent.data = Uri.fromParts("package", context.packageName, null)
        }
      }

      val resolvable = context.packageManager.resolveActivity(intent, 0) != null
      if (!resolvable) {
        intent.action = Settings.ACTION_APPLICATION_DETAILS_SETTINGS
        intent.component = null
        intent.data = Uri.fromParts("package", context.packageName, null)
      }

      val opened = try {
        context.startActivity(intent)
        true
      } catch (_: Exception) {
        false
      }

      // Distinguish "landed on the vendor auto-start page" from "fell back to app details",
      // otherwise the UI cannot tell the user that the ROM has no known auto-start screen.
      when {
        !opened -> ""
        resolvable -> "autostart"
        else -> "appdetails"
      }
    }
  }

  private companion object {
    /** Shorter than Android's own window, so a miss is noticed before the system kills us. */
    const val WATCHDOG_MS = 4000L
  }
}
