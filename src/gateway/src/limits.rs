//! Rate limits per API key and per organisation: requests per minute, tokens per minute and tokens per UTC day.
//! Counters live in this process (see docs/gateway.md): per-minute limits are therefore per gateway instance, and the
//! daily token total is re-read from `usage_records` every few seconds so several instances see each other's usage
//! (approximate within the flush interval). A request is refused with `429` before any node is touched.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Clone, Copy, Default, PartialEq, Debug)]
pub struct Limits {
    pub requests_per_minute: Option<u32>,
    pub tokens_per_minute: Option<u32>,
    pub tokens_per_day: Option<u64>,
}

impl Limits {
    pub fn any(&self) -> bool {
        self.requests_per_minute.is_some() || self.tokens_per_minute.is_some() || self.tokens_per_day.is_some()
    }
}

#[derive(Hash, PartialEq, Eq, Clone, Copy, Debug)]
pub enum Subject {
    Org(Uuid),
    Key(Uuid),
}

#[derive(Default)]
struct State {
    minute: i64,
    requests: u32,
    tokens: u64,
    day: i64,
    /// Tokens of the day as of the last database read, plus what this process recorded since.
    day_base: u64,
    day_local: u64,
    day_read_at: Option<Instant>,
}

#[derive(Debug, PartialEq)]
pub struct Refused {
    pub retry_after_secs: u32,
    pub what: &'static str,
}

#[derive(Default)]
pub struct Limiter {
    state: Mutex<HashMap<Subject, State>>,
}

const DAY_REREAD: Duration = Duration::from_secs(10);

fn now_minute(now: i64) -> i64 {
    now / 60
}

impl Limiter {
    /// Whether `subject` may make another request now, given its limits. Does not count anything.
    pub fn check(&self, subject: Subject, limits: &Limits, now: i64) -> Result<(), Refused> {
        if !limits.any() {
            return Ok(());
        }
        let mut all = self.state.lock().unwrap();
        let s = all.entry(subject).or_default();
        roll(s, now);
        let to_next_minute = (60 - now.rem_euclid(60)) as u32;
        if limits.requests_per_minute.is_some_and(|l| s.requests >= l) {
            return Err(Refused {
                retry_after_secs: to_next_minute,
                what: "requests per minute",
            });
        }
        if limits.tokens_per_minute.is_some_and(|l| s.tokens >= l as u64) {
            return Err(Refused {
                retry_after_secs: to_next_minute,
                what: "tokens per minute",
            });
        }
        if limits.tokens_per_day.is_some_and(|l| s.day_base + s.day_local >= l) {
            let to_midnight = (86_400 - now.rem_euclid(86_400)) as u32;
            return Err(Refused {
                retry_after_secs: to_midnight.min(3600),
                what: "tokens per day",
            });
        }
        Ok(())
    }

    /// Counts an admitted request and its (estimated) prompt tokens.
    pub fn admit(&self, subject: Subject, tokens_in: u64, now: i64) {
        let mut all = self.state.lock().unwrap();
        let s = all.entry(subject).or_default();
        roll(s, now);
        s.requests += 1;
        s.tokens += tokens_in;
        s.day_local += tokens_in;
    }

    /// Counts generated tokens as they are known.
    pub fn add_tokens(&self, subject: Subject, tokens: u64, now: i64) {
        let mut all = self.state.lock().unwrap();
        let s = all.entry(subject).or_default();
        roll(s, now);
        s.tokens += tokens;
        s.day_local += tokens;
    }

    fn needs_day_read(&self, subject: Subject) -> bool {
        let all = self.state.lock().unwrap();
        all.get(&subject)
            .and_then(|s| s.day_read_at)
            .is_none_or(|t| t.elapsed() >= DAY_REREAD)
    }

    fn set_day_base(&self, subject: Subject, total: u64) {
        let mut all = self.state.lock().unwrap();
        let s = all.entry(subject).or_default();
        s.day_base = total;
        s.day_local = 0;
        s.day_read_at = Some(Instant::now());
    }

    /// Refreshes the day's token total from `usage_records` when it is stale (only for subjects with a daily limit).
    pub async fn refresh_day(&self, db: &PgPool, subject: Subject, limits: &Limits) {
        if limits.tokens_per_day.is_none() || !self.needs_day_read(subject) {
            return;
        }
        let start = Utc::now().date_naive().and_hms_opt(0, 0, 0).unwrap().and_utc();
        let total: Result<Option<i64>, _> =
            match subject {
                Subject::Org(id) => sqlx::query_scalar(
                    "select sum(tokens_in + tokens_out)::bigint from usage_records where org_id = $1 and bucket >= $2",
                )
                .bind(id)
                .bind(start)
                .fetch_one(db)
                .await,
                Subject::Key(id) => sqlx::query_scalar(
                    "select sum(tokens_in + tokens_out)::bigint from usage_records where key_id = $1 and bucket >= $2",
                )
                .bind(id)
                .bind(start)
                .fetch_one(db)
                .await,
            };
        if let Ok(t) = total {
            self.set_day_base(subject, t.unwrap_or(0).max(0) as u64);
        }
        // On a database error the old base stays: the limit keeps being enforced from what this process has seen.
    }

    /// Drops state of subjects idle for a while (called from a periodic task).
    pub fn prune(&self, now: i64) {
        self.state
            .lock()
            .unwrap()
            .retain(|_, s| now_minute(now) - s.minute < 5 || s.day == now / 86_400 && s.day_local > 0);
    }
}

fn roll(s: &mut State, now: i64) {
    let m = now_minute(now);
    if s.minute != m {
        s.minute = m;
        s.requests = 0;
        s.tokens = 0;
    }
    let d = now / 86_400;
    if s.day != d {
        s.day = d;
        s.day_base = 0;
        s.day_local = 0;
        s.day_read_at = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const T: i64 = 1_700_000_000; // an arbitrary instant

    #[test]
    fn unlimited_never_refuses_and_costs_nothing() {
        let l = Limiter::default();
        let s = Subject::Key(Uuid::new_v4());
        for _ in 0..1000 {
            assert!(l.check(s, &Limits::default(), T).is_ok());
            l.admit(s, 10, T);
        }
    }

    #[test]
    fn requests_per_minute_resets_with_the_window() {
        let l = Limiter::default();
        let s = Subject::Org(Uuid::new_v4());
        let lim = Limits {
            requests_per_minute: Some(2),
            ..Default::default()
        };
        for _ in 0..2 {
            assert!(l.check(s, &lim, T).is_ok());
            l.admit(s, 1, T);
        }
        let r = l.check(s, &lim, T).unwrap_err();
        assert_eq!(r.what, "requests per minute");
        assert!(r.retry_after_secs >= 1 && r.retry_after_secs <= 60);
        assert!(l.check(s, &lim, T + 60).is_ok());
    }

    #[test]
    fn tokens_per_minute_counts_prompt_and_completion() {
        let l = Limiter::default();
        let s = Subject::Key(Uuid::new_v4());
        let lim = Limits {
            tokens_per_minute: Some(100),
            ..Default::default()
        };
        l.admit(s, 60, T);
        assert!(l.check(s, &lim, T).is_ok());
        l.add_tokens(s, 40, T);
        assert_eq!(l.check(s, &lim, T).unwrap_err().what, "tokens per minute");
        assert!(l.check(s, &lim, T + 61).is_ok());
    }

    #[test]
    fn tokens_per_day_uses_the_database_total_plus_local_and_rolls_at_midnight() {
        let l = Limiter::default();
        let s = Subject::Org(Uuid::new_v4());
        let lim = Limits {
            tokens_per_day: Some(1000),
            ..Default::default()
        };
        let day = 19_675 * 86_400; // a UTC midnight
        l.check(s, &lim, day + 10).unwrap();
        l.set_day_base(s, 900); // what other instances already flushed
        l.add_tokens(s, 50, day + 10);
        assert!(l.check(s, &lim, day + 20).is_ok());
        l.add_tokens(s, 60, day + 20);
        let r = l.check(s, &lim, day + 30).unwrap_err();
        assert_eq!(r.what, "tokens per day");
        assert!(r.retry_after_secs <= 3600);
        assert!(l.check(s, &lim, day + 86_400 + 1).is_ok()); // next UTC day
    }

    #[test]
    fn subjects_are_independent() {
        let l = Limiter::default();
        let (a, b) = (Subject::Key(Uuid::new_v4()), Subject::Key(Uuid::new_v4()));
        let lim = Limits {
            requests_per_minute: Some(1),
            ..Default::default()
        };
        l.admit(a, 1, T);
        assert!(l.check(a, &lim, T).is_err());
        assert!(l.check(b, &lim, T).is_ok());
    }
}
