package com.splitcortex.nodeservice

import android.content.Context
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

    AsyncFunction("getTelemetry") { Telemetry.read(context) }
  }
}
