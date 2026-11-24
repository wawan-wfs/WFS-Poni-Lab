use super::Store;
use chrono::{Local, NaiveDate, TimeZone};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

const MINUTE: u64 = 60_000;
const IDLE_BREAK: u64 = 5 * MINUTE;
const LOCKED_BREAK: u64 = 2 * MINUTE;

#[derive(Clone, Deserialize, Serialize)]
#[serde(default)]
pub(super) struct Preferences {
    water_goal: u8,
    break_goal: u8,
    mindful_goal: u8,
    pub(super) eye_duration: u8,
    pub(super) enabled: bool,
    break_reminders: bool,
    break_interval: u8,
    water_reminders: bool,
    water_interval: u8,
    eye_breaks: bool,
    eye_interval: u8,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            water_goal: 8,
            break_goal: 6,
            mindful_goal: 5,
            eye_duration: 20,
            enabled: true,
            break_reminders: true,
            break_interval: 50,
            water_reminders: false,
            water_interval: 60,
            eye_breaks: false,
            eye_interval: 20,
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Patch {
    water_goal: Option<u8>,
    break_goal: Option<u8>,
    mindful_goal: Option<u8>,
    eye_duration: Option<u8>,
    enabled: Option<bool>,
    break_reminders: Option<bool>,
    break_interval: Option<u8>,
    water_reminders: Option<bool>,
    water_interval: Option<u8>,
    eye_breaks: Option<bool>,
    eye_interval: Option<u8>,
}

impl Preferences {
    pub(super) fn apply(&mut self, patch: Patch) -> Result<(), String> {
        let water = patch.water_goal.unwrap_or(self.water_goal);
        let breaks = patch.break_goal.unwrap_or(self.break_goal);
        let mindful = patch.mindful_goal.unwrap_or(self.mindful_goal);
        let eye_duration = patch.eye_duration.unwrap_or(self.eye_duration);
        let break_interval = patch.break_interval.unwrap_or(self.break_interval);
        let water_interval = patch.water_interval.unwrap_or(self.water_interval);
        let eye_interval = patch.eye_interval.unwrap_or(self.eye_interval);
        if !(2..=16).contains(&water)
            || !(1..=16).contains(&breaks)
            || !(1..=30).contains(&mindful)
            || !(10..=60).contains(&eye_duration)
            || !eye_duration.is_multiple_of(5)
            || !(15..=120).contains(&break_interval)
            || !(5..=180).contains(&water_interval)
            || !(10..=60).contains(&eye_interval)
            || [break_interval, water_interval, eye_interval]
                .iter()
                .any(|value| !value.is_multiple_of(5))
        {
            return Err("Choose Health targets and intervals within the displayed ranges".into());
        }
        self.water_goal = water;
        self.break_goal = breaks;
        self.mindful_goal = mindful;
        self.eye_duration = eye_duration;
        self.enabled = patch.enabled.unwrap_or(self.enabled);
        self.break_reminders = patch.break_reminders.unwrap_or(self.break_reminders);
        self.break_interval = break_interval;
        self.water_reminders = patch.water_reminders.unwrap_or(self.water_reminders);
        self.water_interval = water_interval;
        self.eye_breaks = patch.eye_breaks.unwrap_or(self.eye_breaks);
        self.eye_interval = eye_interval;
        Ok(())
    }
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub(crate) struct DayTotals {
    water: u16,
    breaks: u16,
    mindful: u16,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub(crate) struct Health {
    day: Option<u32>,
    today: DayTotals,
    last_break_ms: Option<u64>,
    last_water_ms: Option<u64>,
    last_active_day: Option<u32>,
    streak: u32,
}

impl Health {
    fn advance_to(&mut self, day: u32) {
        if self.day != Some(day) {
            self.day = Some(day);
            self.today = DayTotals::default();
            self.last_water_ms = None;
        }
        if self
            .last_active_day
            .is_some_and(|last| last.abs_diff(day) > 1)
        {
            self.streak = 0;
        }
    }

    fn record(&mut self, day: u32, action: HealthAction, now_ms: u64) {
        self.advance_to(day);
        match action {
            HealthAction::WaterAdd => {
                self.today.water = self.today.water.saturating_add(1);
                self.last_water_ms = Some(now_ms);
            }
            HealthAction::WaterRemove => {
                self.today.water = self.today.water.saturating_sub(1);
                return;
            }
            HealthAction::Stretch => {
                self.today.breaks = self.today.breaks.saturating_add(1);
                self.last_break_ms = Some(now_ms);
            }
            HealthAction::Breathing => self.today.mindful = self.today.mindful.saturating_add(1),
        }
        if self.last_active_day != Some(day) {
            self.streak =
                if self.last_active_day == day.checked_sub(1) && self.last_active_day.is_some() {
                    self.streak.saturating_add(1)
                } else {
                    1
                };
            self.last_active_day = Some(day);
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum HealthAction {
    WaterAdd,
    WaterRemove,
    Stretch,
    Breathing,
}

fn clock() -> Result<(u64, u32), String> {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "Health needs a valid system clock")?;
    Ok((
        elapsed.as_millis() as u64,
        (elapsed.as_secs() / 86_400) as u32,
    ))
}

fn validate_local_day(day: u32, utc_day: u32) -> Result<(), String> {
    if day.abs_diff(utc_day) > 1 {
        return Err("Health needs a valid local date".into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn health_state(store: State<'_, Mutex<Store>>, day: u32) -> Result<Health, String> {
    let (_, utc_day) = clock()?;
    validate_local_day(day, utc_day)?;
    let mut health = store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .data
        .health
        .clone();
    health.advance_to(day);
    Ok(health)
}

#[tauri::command]
pub(crate) fn health_record(
    app: AppHandle,
    store: State<'_, Mutex<Store>>,
    day: u32,
    action: HealthAction,
) -> Result<Health, String> {
    let (now_ms, utc_day) = clock()?;
    validate_local_day(day, utc_day)?;
    let updated = store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            data.health.record(day, action, now_ms);
            Ok(())
        })?;
    let _ = app.emit_to("main", "poni-health-changed", &updated.health);
    Ok(updated.health)
}

#[derive(Clone, Copy)]
enum Activity {
    Unlocked { idle_ms: u64 },
    Locked,
}

#[derive(Default)]
pub(super) struct Tracker {
    sampled: Option<Instant>,
    day: Option<u32>,
    last_water_ms: Option<u64>,
    last_break_ms: Option<u64>,
    active_ms: u64,
    water_ms: u64,
    eye_ms: u64,
    locked_ms: u64,
    can_count_break: bool,
    was_locked: bool,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
enum Notice {
    Break {
        minutes: u8,
        expires_at_ms: u64,
    },
    Water {
        glasses: u16,
        goal: u8,
        expires_at_ms: u64,
    },
}

#[derive(Default)]
struct Effects {
    count_break: bool,
    notice: Option<Notice>,
    eye_break: bool,
}

impl Tracker {
    fn advance(
        &mut self,
        preferences: &Preferences,
        health: &Health,
        day: u32,
        now: u64,
        elapsed: u64,
        activity: Activity,
    ) -> Effects {
        let mut effects = Effects::default();
        if !preferences.enabled {
            *self = Self {
                sampled: self.sampled,
                ..Self::default()
            };
            return effects;
        }
        let new_day = self.day != Some(day);
        if new_day || self.last_water_ms != health.last_water_ms {
            self.water_ms = 0;
            self.last_water_ms = health.last_water_ms;
        }
        if new_day || self.last_break_ms != health.last_break_ms {
            self.active_ms = 0;
            self.eye_ms = 0;
            self.last_break_ms = health.last_break_ms;
        }
        self.day = Some(day);
        let idle_ms = match activity {
            Activity::Locked => {
                if self.was_locked {
                    self.locked_ms = self.locked_ms.saturating_add(elapsed);
                }
                self.was_locked = true;
                if self.can_count_break && self.locked_ms >= LOCKED_BREAK {
                    self.can_count_break = false;
                    self.active_ms = 0;
                    self.eye_ms = 0;
                    effects.count_break = true;
                }
                return effects;
            }
            Activity::Unlocked { idle_ms } => idle_ms,
        };
        let resumed = self.was_locked;
        self.was_locked = false;
        self.locked_ms = 0;
        if idle_ms >= IDLE_BREAK {
            self.active_ms = 0;
            self.eye_ms = 0;
            effects.count_break = std::mem::take(&mut self.can_count_break);
            return effects;
        }
        if idle_ms >= LOCKED_BREAK {
            return effects;
        }
        self.can_count_break = true;
        let elapsed = if resumed || new_day { 0 } else { elapsed };
        if preferences.break_reminders {
            self.active_ms = self.active_ms.saturating_add(elapsed);
            if self.active_ms >= u64::from(preferences.break_interval) * MINUTE {
                self.active_ms = 0;
                effects.notice = Some(Notice::Break {
                    minutes: preferences.break_interval,
                    expires_at_ms: now.saturating_add(8000),
                });
            }
        } else {
            self.active_ms = 0;
        }
        let glasses = if health.day == Some(day) {
            health.today.water
        } else {
            0
        };
        if preferences.water_reminders && glasses < u16::from(preferences.water_goal) {
            self.water_ms = self.water_ms.saturating_add(elapsed);
            if effects.notice.is_none()
                && self.water_ms >= u64::from(preferences.water_interval) * MINUTE
            {
                self.water_ms = 0;
                effects.notice = Some(Notice::Water {
                    glasses,
                    goal: preferences.water_goal,
                    expires_at_ms: now.saturating_add(10_000),
                });
            }
        } else {
            self.water_ms = 0;
        }
        if preferences.eye_breaks {
            self.eye_ms = self.eye_ms.saturating_add(elapsed);
            if self.eye_ms >= u64::from(preferences.eye_interval) * MINUTE {
                self.eye_ms = 0;
                effects.eye_break = true;
            }
        } else {
            self.eye_ms = 0;
        }
        effects
    }
}

pub(super) fn tick(app: &AppHandle, now: u64) {
    let current = Instant::now();
    let Some(idle_ms) = crate::activity::idle_millis() else {
        return;
    };
    let activity = if crate::activity::desktop_available() {
        Activity::Unlocked {
            idle_ms: u64::from(idle_ms),
        }
    } else {
        Activity::Locked
    };
    let Some(date) = i64::try_from(now)
        .ok()
        .and_then(|ms| Local.timestamp_millis_opt(ms).single())
        .map(|time| time.date_naive())
    else {
        return;
    };
    let epoch = NaiveDate::from_ymd_opt(1970, 1, 1).expect("Unix epoch");
    let Ok(day) = u32::try_from((date - epoch).num_days()) else {
        return;
    };
    let state = app.state::<Mutex<Tracker>>();
    let Ok(mut tracker) = state.lock() else {
        return;
    };
    let elapsed = tracker
        .sampled
        .replace(current)
        .map(|previous| current.duration_since(previous).as_millis() as u64)
        .filter(|elapsed| *elapsed <= 30_000)
        .unwrap_or(0);
    let store = app.state::<Mutex<Store>>();
    let Ok(mut store) = store.lock() else { return };
    let preferences = store.data.settings.health.clone();
    let effects = tracker.advance(
        &preferences,
        &store.data.health,
        day,
        now,
        elapsed,
        activity,
    );
    if effects.count_break {
        match store.update(|data| {
            data.health.record(day, HealthAction::Stretch, now);
            Ok(())
        }) {
            Ok(updated) => {
                let _ = app.emit_to("main", "poni-health-changed", updated.health);
            }
            Err(error) => {
                tracker.can_count_break = true;
                eprintln!("Could not save automatic Health break: {error}");
            }
        }
    }
    drop(store);
    drop(tracker);
    if let Some(notice) = effects.notice {
        let _ = app.emit_to("main", "poni-health-reminder", notice);
        crate::sound::play_bedtime(false);
    }
    if effects.eye_break {
        let _ = crate::eye_break::schedule(app, preferences.eye_duration);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_an_idle_or_locked_break_once_per_absence() {
        let mut tracker = Tracker::default();
        let preferences = Preferences::default();
        let health = Health::default();
        let awake = Activity::Unlocked { idle_ms: 0 };
        let idle = Activity::Unlocked {
            idle_ms: IDLE_BREAK,
        };
        let observe = |tracker: &mut Tracker, activity, elapsed| {
            tracker.advance(&preferences, &health, 10, 180_000, elapsed, activity)
        };
        assert!(!observe(&mut tracker, idle, 15_000).count_break);
        observe(&mut tracker, awake, 15_000);
        assert!(observe(&mut tracker, idle, 15_000).count_break);
        assert!(!observe(&mut tracker, idle, 15_000).count_break);
        observe(&mut tracker, awake, 15_000);
        assert!(!observe(&mut tracker, Activity::Locked, 15_000).count_break);
        for _ in 0..7 {
            assert!(!observe(&mut tracker, Activity::Locked, 15_000).count_break);
        }
        assert!(observe(&mut tracker, Activity::Locked, 15_000).count_break);
        assert!(!observe(&mut tracker, idle, 15_000).count_break);
    }

    #[test]
    fn active_reminders_follow_their_intervals_and_daily_water_goal() {
        let mut tracker = Tracker::default();
        let mut health = Health::default();
        let mut preferences = Preferences {
            water_goal: 2,
            break_interval: 15,
            water_interval: 5,
            water_reminders: true,
            eye_breaks: true,
            eye_interval: 10,
            ..Preferences::default()
        };
        let awake = Activity::Unlocked { idle_ms: 0 };
        tracker.advance(&preferences, &health, 10, 0, 0, awake);
        let effects = tracker.advance(&preferences, &health, 10, 300_000, 300_000, awake);
        assert!(matches!(
            effects.notice,
            Some(Notice::Water {
                glasses: 0,
                goal: 2,
                ..
            })
        ));
        health.record(10, HealthAction::WaterAdd, 300_010);
        health.record(10, HealthAction::WaterAdd, 300_020);
        let effects = tracker.advance(&preferences, &health, 10, 600_000, 300_000, awake);
        assert!(effects.notice.is_none());
        assert!(effects.eye_break);
        let effects = tracker.advance(&preferences, &health, 10, 900_000, 300_000, awake);
        assert!(matches!(
            effects.notice,
            Some(Notice::Break { minutes: 15, .. })
        ));
        preferences.enabled = false;
        assert!(tracker
            .advance(&preferences, &health, 10, 1_200_000, 300_000, awake)
            .notice
            .is_none());
        preferences.enabled = true;
        tracker.advance(&preferences, &health, 11, 1_210_000, 0, awake);
        let effects = tracker.advance(&preferences, &health, 11, 1_510_000, 300_000, awake);
        assert!(matches!(
            effects.notice,
            Some(Notice::Water { glasses: 0, .. })
        ));
    }

    #[test]
    fn preferences_preserve_unedited_goals_and_validate_eye_duration() {
        let mut preferences = Preferences::default();
        assert_eq!(preferences.break_goal, 6);
        let patch = serde_json::from_str(r#"{"water_goal":10,"eye_duration":35}"#).unwrap();
        preferences.apply(patch).unwrap();
        let invalid = serde_json::from_str(r#"{"break_goal":8,"eye_duration":33}"#).unwrap();
        assert!(preferences.apply(invalid).is_err());
        let saved = serde_json::to_string(&preferences).unwrap();
        let restored: Preferences = serde_json::from_str(&saved).unwrap();
        assert_eq!(restored.water_goal, 10);
        assert_eq!(restored.break_goal, 6);
        assert_eq!(restored.mindful_goal, 5);
        assert_eq!(restored.eye_duration, 35);
    }

    #[test]
    fn rolls_over_daily_totals_and_keeps_streak_for_adjacent_days() {
        let mut health = Health::default();
        health.record(10, HealthAction::WaterRemove, 100);
        assert_eq!(health.today.water, 0);
        health.record(10, HealthAction::WaterAdd, 100);
        health.record(10, HealthAction::Stretch, 200);
        assert_eq!(health.last_break_ms, Some(200));
        health.record(11, HealthAction::Breathing, 300);
        assert_eq!(health.today.water, 0);
        assert_eq!(health.today.breaks, 0);
        assert_eq!(health.today.mindful, 1);
        assert_eq!(health.streak, 2);

        health.advance_to(13);
        assert_eq!(health.today.mindful, 0);
        assert_eq!(health.streak, 0);
        assert_eq!(health.last_break_ms, Some(200));
    }
}
