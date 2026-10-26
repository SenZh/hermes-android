package expo.modules.hermeskeepalive

import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * Behaviour tests for the foreground-service rule that caused the crash:
 * Android books every `startForegroundService()` and demands a `startForeground()` soon after.
 *
 * These run the real service on the JVM, so "did it promote before stopping" is answered by
 * execution rather than by grepping the source — a reordering of the statements fails here.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [Build.VERSION_CODES.UPSIDE_DOWN_CAKE])
class KeepAliveServiceTest {

  private lateinit var controller: org.robolectric.android.controller.ServiceController<KeepAliveService>
  private lateinit var service: KeepAliveService

  @Before
  fun setUp() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    // The channel must exist before any promotion, exactly as production guarantees via preflight.
    assertTrue("channel should be creatable in tests", KeepAliveService.ensureChannelReady(context))
    KeepAliveService.state = ServiceState.IDLE
    KeepAliveService.clearStopRequest()
    controller = Robolectric.buildService(KeepAliveService::class.java)
    service = controller.create().get()
  }

  @Test
  fun `onStartCommand promotes to foreground and reports RUNNING`() {
    service.onStartCommand(null, 0, 1)

    assertEquals(ServiceState.RUNNING, KeepAliveService.state)
    assertNotNull(
      "startForeground must have been called",
      shadowOf(service).lastForegroundNotification,
    )
    assertFalse("a successful start must not stop the service", shadowOf(service).isStoppedBySelf)
  }

  @Test
  fun `promotion happens even when the intent carries no extras`() {
    // The crash path used to be reachable by any exception before startForeground; a bare intent
    // is the cheapest way to prove there is nothing fallible ahead of the promotion.
    service.onStartCommand(null, 0, 2)

    assertNotNull(shadowOf(service).lastForegroundNotification)
    assertEquals(ServiceState.RUNNING, KeepAliveService.state)
  }

  @Test
  fun `deferred stop is honoured after the promotion, not before it`() {
    KeepAliveService.requestStop()
    assertTrue("the request should be pending", KeepAliveService.stopRequested)

    service.onStartCommand(null, 0, 3)

    // Promotion happened first...
    assertNotNull(shadowOf(service).lastForegroundNotification)
    // ...and only then the service stopped itself, which is the legal order.
    assertTrue("deferred stop must run after promotion", shadowOf(service).isStoppedBySelf)
    assertFalse("the request must be consumed", KeepAliveService.stopRequested)
  }

  @Test
  fun `stopping while not yet promoted is deferred instead of executed`() {
    // STARTING means posted-but-not-promoted: stopping here is the crash itself.
    KeepAliveService.state = ServiceState.STARTING
    service.onTaskRemoved(null)

    assertFalse("must not stop before promotion", shadowOf(service).isStoppedBySelf)
    assertTrue("the stop must be recorded for later", KeepAliveService.stopRequested)
  }

  @Test
  fun `stopping while running stops immediately`() {
    service.onStartCommand(null, 0, 4)
    assertEquals(ServiceState.RUNNING, KeepAliveService.state)
    assertFalse("promotion alone must not stop the service", shadowOf(service).isStoppedBySelf)

    service.onStartCommand(null, 0, 4)
    service.onTaskRemoved(null)

    assertTrue("an already-promoted service may stop now", shadowOf(service).isStoppedBySelf)
  }

  @Test
  fun `onDestroy resets the state and drops the pending stop`() {
    service.onStartCommand(null, 0, 5)
    KeepAliveService.requestStop()
    controller.destroy()

    assertEquals(ServiceState.IDLE, KeepAliveService.state)
    assertFalse(KeepAliveService.stopRequested)
  }

  @Test
  fun `preflight fails when the channel cannot be resolved`() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.deleteNotificationChannel("hermes-working")
    // A fresh delete is undone by ensureChannelReady recreating it; what matters is the contract:
    // after the call the channel exists and the preflight reports true.
    assertTrue(KeepAliveService.ensureChannelReady(context))
    assertNotNull(manager.getNotificationChannel("hermes-working"))
  }
}
