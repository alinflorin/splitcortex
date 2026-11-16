package com.splitcortex.nodeservice

import android.content.Context

/** Settings the boot receiver needs before any JavaScript runs. The JS settings screen is the source of truth and mirrors them here. */
object Prefs {
  private const val FILE = "splitcortex_node_service"
  private const val START_AT_BOOT = "start_at_boot"

  /** On by default, like the setting in the app. */
  fun startAtBoot(context: Context): Boolean =
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getBoolean(START_AT_BOOT, true)

  fun setStartAtBoot(context: Context, enabled: Boolean) {
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putBoolean(START_AT_BOOT, enabled).apply()
  }
}
