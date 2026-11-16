//! Runs the node in the background and at login: a systemd user unit on Linux, a launchd agent on macOS and a scheduled
//! task (at logon) on Windows. `run` is the foreground command all of them start.

use crate::storage::Dirs;
use anyhow::{Context, Result, bail};
use std::path::PathBuf;
use std::process::Command;

fn exe() -> Result<PathBuf> {
    std::env::current_exe()
        .and_then(|p| p.canonicalize())
        .context("cannot find this executable")
}

#[cfg(not(windows))]
fn home() -> Result<PathBuf> {
    directories::BaseDirs::new()
        .map(|d| d.home_dir().to_path_buf())
        .context("cannot find the home directory")
}

fn run_cmd(cmd: &mut Command) -> Result<()> {
    let out = cmd
        .output()
        .with_context(|| format!("cannot run {:?}", cmd.get_program()))?;
    if !out.status.success() {
        bail!(
            "{:?} failed: {}",
            cmd.get_program(),
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn unit_path() -> Result<PathBuf> {
    Ok(home()?.join(".config/systemd/user/splitcortex-node.service"))
}

#[cfg(target_os = "macos")]
fn plist_path() -> Result<PathBuf> {
    Ok(home()?.join("Library/LaunchAgents/com.splitcortex.node.plist"))
}

#[cfg(target_os = "linux")]
pub fn install(_dirs: &Dirs) -> Result<()> {
    let path = unit_path()?;
    std::fs::create_dir_all(path.parent().context("no parent")?)?;
    std::fs::write(
        &path,
        format!(
            "[Unit]\nDescription=SplitCortex node\nAfter=network-online.target\nWants=network-online.target\n\n\
             [Service]\nExecStart=\"{}\" run\nRestart=always\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n",
            exe()?.display()
        ),
    )?;
    run_cmd(Command::new("systemctl").args(["--user", "daemon-reload"]))?;
    run_cmd(Command::new("systemctl").args([
        "--user",
        "enable",
        "--now",
        "splitcortex-node.service",
    ]))?;
    println!("Installed and started: {}", path.display());
    println!("Logs:   journalctl --user -u splitcortex-node -f");
    println!("To keep it running when you are logged out: loginctl enable-linger $USER");
    Ok(())
}

#[cfg(target_os = "linux")]
pub fn uninstall() -> Result<()> {
    let _ = run_cmd(Command::new("systemctl").args([
        "--user",
        "disable",
        "--now",
        "splitcortex-node.service",
    ]));
    let path = unit_path()?;
    if path.exists() {
        std::fs::remove_file(&path)?;
    }
    let _ = run_cmd(Command::new("systemctl").args(["--user", "daemon-reload"]));
    println!("Removed the service");
    Ok(())
}

#[cfg(target_os = "linux")]
pub fn status() -> Result<()> {
    let _ = Command::new("systemctl")
        .args(["--user", "status", "splitcortex-node.service", "--no-pager"])
        .status();
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn install(dirs: &Dirs) -> Result<()> {
    let path = plist_path()?;
    std::fs::create_dir_all(path.parent().context("no parent")?)?;
    std::fs::create_dir_all(&dirs.cache)?;
    let log = dirs.cache.join("node.log");
    std::fs::write(
        &path,
        format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \
             \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\"><dict>\n\
             <key>Label</key><string>com.splitcortex.node</string>\n\
             <key>ProgramArguments</key><array><string>{}</string><string>run</string></array>\n\
             <key>RunAtLoad</key><true/>\n<key>KeepAlive</key><true/>\n\
             <key>StandardOutPath</key><string>{log}</string>\n<key>StandardErrorPath</key><string>{log}</string>\n\
             </dict></plist>\n",
            exe()?.display(),
            log = log.display()
        ),
    )?;
    let uid = String::from_utf8_lossy(&Command::new("id").arg("-u").output()?.stdout)
        .trim()
        .to_string();
    let target = format!("gui/{uid}");
    let _ = run_cmd(
        Command::new("launchctl").args(["bootout", &format!("{target}/com.splitcortex.node")]),
    );
    run_cmd(Command::new("launchctl").args(["bootstrap", &target, &path.display().to_string()]))?;
    println!("Installed and started: {}", path.display());
    println!("Log: {}", log.display());
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn uninstall() -> Result<()> {
    let uid = String::from_utf8_lossy(&Command::new("id").arg("-u").output()?.stdout)
        .trim()
        .to_string();
    let _ = run_cmd(
        Command::new("launchctl").args(["bootout", &format!("gui/{uid}/com.splitcortex.node")]),
    );
    let path = plist_path()?;
    if path.exists() {
        std::fs::remove_file(&path)?;
    }
    println!("Removed the service");
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn status() -> Result<()> {
    let _ = Command::new("launchctl")
        .args(["list", "com.splitcortex.node"])
        .status();
    Ok(())
}

#[cfg(target_os = "windows")]
const TASK: &str = "SplitCortexNode";

#[cfg(target_os = "windows")]
pub fn install(dirs: &Dirs) -> Result<()> {
    std::fs::create_dir_all(&dirs.cache)?;
    let log = dirs.cache.join("node.log");
    let command = format!(
        "cmd /c \"\"{}\" run >> \"{}\" 2>&1\"",
        exe()?.display(),
        log.display()
    );
    run_cmd(Command::new("schtasks").args([
        "/Create", "/TN", TASK, "/TR", &command, "/SC", "ONLOGON", "/F",
    ]))?;
    run_cmd(Command::new("schtasks").args(["/Run", "/TN", TASK]))?;
    println!(
        "Installed and started the scheduled task {TASK} (runs at logon). Log: {}",
        log.display()
    );
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn uninstall() -> Result<()> {
    let _ = run_cmd(Command::new("schtasks").args(["/End", "/TN", TASK]));
    run_cmd(Command::new("schtasks").args(["/Delete", "/TN", TASK, "/F"]))?;
    println!("Removed the service");
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn status() -> Result<()> {
    let _ = Command::new("schtasks")
        .args(["/Query", "/TN", TASK])
        .status();
    Ok(())
}
