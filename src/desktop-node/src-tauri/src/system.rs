//! What the node tells the platform about this computer, telemetry, sleep prevention and the updater gate.

use serde::Serialize;
use std::sync::Mutex;
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    name: String,
    os: String,
    os_version: String,
    model: String,
    cpu_cores: u32,
    memory_total_mb: u64,
    app_version: String,
}

#[tauri::command]
pub fn device_info(app: tauri::AppHandle) -> DeviceInfo {
    let sys = System::new().ok().map(|mut sys| {
        sys.refresh_memory();
        sys.refresh_cpu_list(sysinfo::CpuRefreshKind::nothing());
        sys
    });
    DeviceInfo {
        name: System::host_name().unwrap_or_else(|_| "Desktop node".into()),
        os: System::name().unwrap_or_default(),
        os_version: System::os_version().unwrap_or_default(),
        model: format!("{} {}", System::distribution_id(), std::env::consts::ARCH)
            .trim()
            .to_string(),
        cpu_cores: sys.as_ref().map_or(0, |s| s.cpus().len() as u32),
        memory_total_mb: sys.as_ref().map_or(0, |s| s.total_memory() / (1024 * 1024)),
        app_version: app.package_info().version.to_string(),
    }
}

/// Values the protocol treats as unknown: cpu -1, battery -1, temperature -273.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Telemetry {
    cpu_percent: f32,
    memory_used_mb: f64,
    battery_percent: f32,
    charging: bool,
    temperature_c: f32,
}

pub struct Sampler(Mutex<Option<System>>);
impl Default for Sampler {
    fn default() -> Self {
        Sampler(Mutex::new(System::new().ok()))
    }
}

/// This app's own CPU share of the whole machine and its resident memory (the mapped model counts), like the phone
/// app. Battery and temperature are not read yet (unknown sentinels).
#[tauri::command]
pub fn telemetry(sampler: State<'_, Sampler>) -> Telemetry {
    let mut sys = sampler.0.lock().unwrap_or_else(|e| e.into_inner());
    let pid = Pid::from_u32(std::process::id());
    if let Some(sys) = sys.as_mut() {
        sys.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);
    }
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1) as f32;
    let (cpu, mem) = sys
        .as_ref()
        .and_then(|s| s.process(pid))
        .map(|p| (p.cpu_usage() / cores, p.memory() as f64 / (1024.0 * 1024.0)))
        .unwrap_or((-1.0, 0.0));
    Telemetry {
        cpu_percent: cpu,
        memory_used_mb: mem,
        battery_percent: -1.0,
        charging: false,
        temperature_c: -273.0,
    }
}

#[derive(Default)]
pub struct Awake(Mutex<Option<keepawake::KeepAwake>>);

/// Prevents idle sleep while serving (the display may still turn off).
#[tauri::command]
pub fn set_keep_awake(on: bool, awake: State<'_, Awake>) -> Result<(), String> {
    let mut g = awake.0.lock().unwrap_or_else(|e| e.into_inner());
    if on && g.is_none() {
        let k = keepawake::Builder::default()
            .idle(true)
            .sleep(true)
            .reason("SplitCortex node is serving requests")
            .app_name("SplitCortex Node")
            .create()
            .map_err(|e| e.to_string())?;
        *g = Some(k);
    } else if !on {
        *g = None;
    }
    Ok(())
}

/// Whether the updater can replace this installation. On Linux only an AppImage can.
#[tauri::command]
pub fn can_self_update() -> bool {
    if cfg!(target_os = "linux") {
        std::env::var_os("APPIMAGE").is_some()
    } else {
        true
    }
}

/// Restarts the app: a new process with the same arguments (so `--hidden` from autostart is kept) and the old one
/// exits; the tray icon is removed on the way out and the new process sets it up again. Used for the remote restart
/// the gateway asks for. The web side has already closed the gateway socket and unloaded the engines.
#[tauri::command]
pub fn restart_app(app: tauri::AppHandle) {
    app.restart()
}
