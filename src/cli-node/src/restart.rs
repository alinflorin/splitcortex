//! Remote restart (`Restart { grace_seconds }`, gateway to node). The state machine that decides when the node may
//! restart, and the relaunch itself. The runtime drives it: it stops taking requests (answers "restarting"), lets the
//! running ones finish for up to the grace period (then cancels them), closes the gateway connection cleanly, and starts
//! the process again. Port of the same logic in the desktop node; keep them equal.

use std::time::{Duration, Instant};

/// After the grace period the running requests are cancelled; give the engine this long to unwind before restarting anyway.
pub const CANCEL_WAIT: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Action {
    /// Nothing to do (not restarting, or still waiting for requests to finish).
    Wait,
    /// The grace period is over: cancel what still runs (said once).
    Cancel,
    /// Nothing runs any more (or the cancellation had its time): close the socket and relaunch.
    Restart,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum State {
    Running,
    Draining { deadline: Instant },
    Cancelling { until: Instant },
}

#[derive(Debug)]
pub struct Restarter {
    state: State,
}

impl Default for Restarter {
    fn default() -> Self {
        Restarter {
            state: State::Running,
        }
    }
}

impl Restarter {
    /// A `Restart` arrived. A second one while already restarting changes nothing.
    pub fn begin(&mut self, now: Instant, grace: Duration) {
        if self.state == State::Running {
            self.state = State::Draining {
                deadline: now + grace,
            };
        }
    }

    /// New requests are refused from the moment a restart is asked for.
    pub fn restarting(&self) -> bool {
        self.state != State::Running
    }

    /// What to do now, given how many requests are still running.
    pub fn poll(&mut self, now: Instant, in_flight: usize) -> Action {
        match self.state {
            State::Running => Action::Wait,
            State::Draining { .. } if in_flight == 0 => Action::Restart,
            State::Draining { deadline } if now >= deadline => {
                self.state = State::Cancelling {
                    until: now + CANCEL_WAIT,
                };
                Action::Cancel
            }
            State::Draining { .. } => Action::Wait,
            State::Cancelling { until } if in_flight == 0 || now >= until => Action::Restart,
            State::Cancelling { .. } => Action::Wait,
        }
    }
}

/// Starts this program again with the same arguments, in place of the current process where the OS allows it, and
/// returns only if that failed.
///
/// - Unix: `exec` (same PID, so a systemd user unit or a launchd agent sees one uninterrupted process: no restart
///   policy is involved, and it also works in a plain terminal where nothing would restart a process that exited).
/// - Windows: there is no exec: a new process is started detached (and out of the scheduled task's job object, so
///   ending the task does not end it) and this one exits.
pub fn relaunch() -> std::io::Error {
    let exe = std::env::current_exe().unwrap_or_default();
    // Linux appends " (deleted)" when an update replaced the file that is running: start the new one at the same path.
    let exe = exe
        .to_string_lossy()
        .strip_suffix(" (deleted)")
        .map(std::path::PathBuf::from)
        .unwrap_or(exe);
    let mut cmd = std::process::Command::new(exe);
    cmd.args(std::env::args_os().skip(1));
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.exec()
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
        let base = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP;
        // Breakaway is refused when the job does not allow it: then start it without.
        let started = cmd
            .creation_flags(base | CREATE_BREAKAWAY_FROM_JOB)
            .spawn()
            .or_else(|_| cmd.creation_flags(base).spawn());
        match started {
            Ok(_) => std::process::exit(0),
            Err(e) => e,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(t0: Instant, secs: u64) -> Instant {
        t0 + Duration::from_secs(secs)
    }

    #[test]
    fn a_node_that_is_not_restarting_waits_forever() {
        let t0 = Instant::now();
        let mut r = Restarter::default();
        assert!(!r.restarting());
        assert_eq!(r.poll(at(t0, 1000), 0), Action::Wait);
    }

    #[test]
    fn it_restarts_as_soon_as_the_running_requests_finish() {
        let t0 = Instant::now();
        let mut r = Restarter::default();
        r.begin(t0, Duration::from_secs(30));
        assert!(r.restarting());
        assert_eq!(r.poll(at(t0, 1), 2), Action::Wait);
        assert_eq!(r.poll(at(t0, 10), 1), Action::Wait);
        assert_eq!(r.poll(at(t0, 11), 0), Action::Restart);
    }

    #[test]
    fn it_restarts_at_once_when_nothing_is_running() {
        let t0 = Instant::now();
        let mut r = Restarter::default();
        r.begin(t0, Duration::from_secs(30));
        assert_eq!(r.poll(t0, 0), Action::Restart);
    }

    #[test]
    fn after_the_grace_period_it_cancels_once_then_restarts() {
        let t0 = Instant::now();
        let mut r = Restarter::default();
        r.begin(t0, Duration::from_secs(30));
        assert_eq!(r.poll(at(t0, 29), 1), Action::Wait);
        assert_eq!(r.poll(at(t0, 30), 1), Action::Cancel);
        // cancelled: waits for the engine to unwind, but not longer than CANCEL_WAIT
        assert_eq!(r.poll(at(t0, 31), 1), Action::Wait);
        assert_eq!(r.poll(at(t0, 32), 0), Action::Restart);
    }

    #[test]
    fn a_request_that_ignores_the_cancel_does_not_hold_the_restart() {
        let t0 = Instant::now();
        let mut r = Restarter::default();
        r.begin(t0, Duration::from_secs(0));
        assert_eq!(r.poll(t0, 1), Action::Cancel);
        assert_eq!(r.poll(at(t0, 4), 1), Action::Wait);
        assert_eq!(r.poll(at(t0, 5), 1), Action::Restart);
    }

    #[test]
    fn a_second_restart_does_not_extend_the_grace_period() {
        let t0 = Instant::now();
        let mut r = Restarter::default();
        r.begin(t0, Duration::from_secs(10));
        r.begin(at(t0, 5), Duration::from_secs(600));
        assert_eq!(r.poll(at(t0, 10), 1), Action::Cancel);
    }
}
