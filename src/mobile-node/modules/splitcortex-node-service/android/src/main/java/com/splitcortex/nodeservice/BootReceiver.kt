package com.splitcortex.nodeservice

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Starts the node service after the device boots (or the app is updated) when "start at boot" is on. A boot receiver
 * may not start an activity on modern Android, but it may start a foreground service of type `specialUse` (unlike
 * `dataSync` on Android 15), which is why the service uses that type.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    if (!Prefs.startAtBoot(context)) return
    NodeService.start(context)
  }
}
