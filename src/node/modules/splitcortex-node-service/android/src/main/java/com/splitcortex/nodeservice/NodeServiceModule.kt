package com.splitcortex.nodeservice

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.view.WindowManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NodeServiceModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("SplitCortexNodeService")

    /** Starts the foreground service (keeps the process alive and runs the headless task). Needs the app to be in the foreground. */
    AsyncFunction("startService") { NodeService.start(context) }

    AsyncFunction("stopService") { NodeService.stop(context) }

    /** Mirrors the "start at boot" setting for the boot receiver. */
    AsyncFunction("setStartAtBoot") { enabled: Boolean -> Prefs.setStartAtBoot(context, enabled) }

    /**
     * Keeps the display on while the app's screen is showing. Some devices only run the GPU at full speed with the app
     * in the foreground and the display on. It affects the visible activity only: the app has to stay open.
     */
    AsyncFunction("setKeepScreenOn") { enabled: Boolean ->
      val activity = appContext.currentActivity
      activity?.runOnUiThread {
        if (enabled) activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      }
    }

    AsyncFunction("getTelemetry") { Telemetry.read(context) }

    /**
     * Whether Android's battery optimisation (Doze, app standby) is off for this app. While it is on, the system may
     * freeze the network and timers of a background app even with a foreground service, which drops the gateway connection.
     */
    AsyncFunction("isIgnoringBatteryOptimizations") {
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      Build.VERSION.SDK_INT < Build.VERSION_CODES.M || pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    /** Opens the system dialog asking the user to exempt this app; falls back to the settings list if the dialog is not available. */
    AsyncFunction("requestIgnoreBatteryOptimizations") {
      val open = { action: String, withPackage: Boolean ->
        val intent = Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (withPackage) intent.data = Uri.parse("package:${context.packageName}")
        context.startActivity(intent)
      }
      try {
        open(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, true)
      } catch (e: Exception) {
        open(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS, false)
      }
    }
  }
}
