package com.splitcortex.nodeservice

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Process
import android.os.SystemClock

/**
 * Device telemetry for the gateway. Unknown values use the protocol's sentinels (cpu < 0, memory 0, battery < 0,
 * temperature -273). Android forbids reading other apps' CPU (`/proc/stat`) since 8, so CPU is this app's own CPU time
 * as a share of the whole device (all cores), which is the load the node causes.
 */
object Telemetry {
  private var lastCpuMs = 0L
  private var lastWallMs = 0L

  @Synchronized
  fun read(context: Context): Map<String, Any> {
    val cores = Runtime.getRuntime().availableProcessors().coerceAtLeast(1)
    val cpuNow = Process.getElapsedCpuTime()
    val wallNow = SystemClock.elapsedRealtime()
    var cpu = -1.0
    if (lastWallMs != 0L && wallNow > lastWallMs) {
      cpu = ((cpuNow - lastCpuMs).toDouble() / ((wallNow - lastWallMs) * cores) * 100.0).coerceIn(0.0, 100.0)
    }
    lastCpuMs = cpuNow
    lastWallMs = wallNow

    val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val pssKb = am.getProcessMemoryInfo(intArrayOf(Process.myPid())).firstOrNull()?.totalPss ?: 0
    val memoryMb = pssKb / 1024

    // The battery state is a sticky broadcast: registering with a null receiver just returns the last value.
    val battery: Intent? = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
    val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
    val status = battery?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
    val tenthsC = battery?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE) ?: Int.MIN_VALUE

    return mapOf(
      "cpuPercent" to cpu,
      "memoryUsedMb" to memoryMb,
      "batteryPercent" to if (level >= 0 && scale > 0) level * 100 / scale else -1,
      "charging" to (status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL),
      "temperatureC" to if (tenthsC != Int.MIN_VALUE) tenthsC / 10.0 else -273.0,
    )
  }
}
