//! What the node tells the platform about this computer, telemetry and sleep prevention.

use crate::enroll::DeviceInfo;
use std::sync::Mutex;
use sysinfo::{Pid, ProcessesToUpdate, System};

pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

pub fn device_info() -> DeviceInfo {
    let mut sys = System::new();
    sys.refresh_memory();
    sys.refresh_cpu_list(sysinfo::CpuRefreshKind::nothing());
    let join = |a: Option<String>, b: Option<String>| {
        let s = [a, b].into_iter().flatten().collect::<Vec<_>>().join(" ");
        (!s.is_empty()).then_some(s)
    };
    DeviceInfo {
        name: System::host_name().unwrap_or_else(|| "CLI node".into()),
        platform: "cli".into(),
        device_model: Some(
            format!("{} {}", System::distribution_id(), std::env::consts::ARCH)
                .trim()
                .to_string(),
        )
        .filter(|s| !s.is_empty()),
        os_version: join(System::name(), System::os_version()),
        app_version: APP_VERSION.into(),
        cpu_cores: Some(sys.cpus().len() as u32).filter(|n| *n > 0),
        memory_total_mb: Some(sys.total_memory() / (1024 * 1024)).filter(|n| *n > 0),
    }
}

/// Values the protocol treats as unknown: cpu -1, battery -1, temperature -273.
pub struct Telemetry {
    pub cpu_percent: f64,
    pub memory_used_mb: u32,
    pub battery_percent: i32,
    pub charging: bool,
    pub temperature_c: f64,
}

pub struct Sampler(Mutex<System>);
impl Default for Sampler {
    fn default() -> Self {
        Sampler(Mutex::new(System::new()))
    }
}

impl Sampler {
    /// This process's own CPU share of the whole machine and its resident memory (the mapped model counts), like the
    /// phone app. Battery and temperature are not read (unknown values).
    pub fn sample(&self) -> Telemetry {
        let mut sys = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let pid = Pid::from_u32(std::process::id());
        sys.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);
        let cores = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1) as f32;
        let (cpu, mem) = sys
            .process(pid)
            .map(|p| ((p.cpu_usage() / cores) as f64, p.memory() / (1024 * 1024)))
            .unwrap_or((-1.0, 0));
        Telemetry {
            cpu_percent: cpu,
            memory_used_mb: mem as u32,
            battery_percent: -1,
            charging: false,
            temperature_c: -273.0,
        }
    }
}

#[derive(Default)]
pub struct Awake(Mutex<Option<keepawake::KeepAwake>>);

impl Awake {
    /// Prevents idle sleep while serving (the display may still turn off).
    pub fn set(&self, on: bool) -> Result<(), String> {
        let mut g = self.0.lock().unwrap_or_else(|e| e.into_inner());
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
}
