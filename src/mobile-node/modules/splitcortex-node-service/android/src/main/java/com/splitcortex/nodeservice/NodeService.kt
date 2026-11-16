package com.splitcortex.nodeservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.net.wifi.WifiManager
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * The background service that serves inference: a foreground service (so Android keeps the process alive) that runs the
 * headless JS task `SplitCortexNode`, which starts the node runtime (gateway connection, model, engine) without any
 * UI. When the app is open the same JS runtime is used and the task is a no-op that just waits.
 */
class NodeService : HeadlessJsTaskService() {
  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null
  private var taskStarted = false

  override fun onCreate() {
    super.onCreate()
    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
    // The CPU must keep running while the screen is off, or generation and the socket would stall.
    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "splitcortex:node").apply { acquire() }
    // And so must the Wi-Fi radio: without a lock it dozes (power-save) and the gateway connection drops while idle.
    val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    val mode =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) WifiManager.WIFI_MODE_FULL_LOW_LATENCY
      else @Suppress("DEPRECATION") WifiManager.WIFI_MODE_FULL_HIGH_PERF
    wifiLock = wifi?.createWifiLock(mode, "splitcortex:node")?.apply {
      setReferenceCounted(false)
      acquire()
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Every startForegroundService() call must be answered with startForeground().
    promote()
    if (taskStarted) return START_REDELIVER_INTENT
    taskStarted = true
    return super.onStartCommand(intent, flags, startId)
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    // timeout 0: no limit. Allowed in the foreground because the app UI may be open when the service starts.
    HeadlessJsTaskConfig(TASK, Arguments.createMap(), 0, true)

  override fun onDestroy() {
    taskStarted = false
    wakeLock?.let { if (it.isHeld) it.release() }
    wifiLock?.let { if (it.isHeld) it.release() }
    super.onDestroy()
  }

  private fun promote() {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL, "Node service", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Shown while this device is serving inference"
          setShowBadge(false)
        },
      )
    }
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val notification: Notification = NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle("SplitCortex node")
      .setContentText("Serving inference for your organisation")
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(open)
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  companion object {
    const val TASK = "SplitCortexNode"
    private const val CHANNEL = "node_service"
    private const val NOTIFICATION_ID = 1001

    fun start(context: Context) {
      ContextCompat.startForegroundService(context, Intent(context, NodeService::class.java))
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, NodeService::class.java))
    }
  }
}
