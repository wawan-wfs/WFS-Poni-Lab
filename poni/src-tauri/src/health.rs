use super::Store;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

#[derive(Clone, Deserialize, Serialize)]
#[serde(default)]
pub(super) struct Preferences {
    water_goal: u8,
    break_goal: u8,
    mindful_goal: u8,
    eye_duration: u8,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            water_goal: 8,
            break_goal: 6,
            mindful_goal: 5,
            eye_duration: 20,
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
}

impl Preferences {
    pub(super) fn apply(&mut self, patch: Patch) -> Result<(), String> {
        let water = patch.water_goal.unwrap_or(self.water_goal);
        let breaks = patch.break_goal.unwrap_or(self.break_goal);
        let mindful = patch.mindful_goal.unwrap_or(self.mindful_goal);
        let eye_duration = patch.eye_duration.unwrap_or(self.eye_duration);
        if !(2..=16).contains(&water)
            || !(1..=16).contains(&breaks)
            || !(1..=30).contains(&mindful)
            || !(10..=60).contains(&eye_duration)
            || !eye_duration.is_multiple_of(5)
        {
            return Err(
                "Choose targets and an eye break length within the displayed ranges".into(),
            );
        }
        self.water_goal = water;
        self.break_goal = breaks;
        self.mindful_goal = mindful;
        self.eye_duration = eye_duration;
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
    last_active_day: Option<u32>,
    streak: u32,
}

impl Health {
    fn advance_to(&mut self, day: u32) {
        if self.day != Some(day) {
            self.day = Some(day);
            self.today = DayTotals::default();
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
            HealthAction::WaterAdd => self.today.water = self.today.water.saturating_add(1),
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
    Ok(updated.health)
}

#[cfg(test)]
mod tests {
    use super::*;

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
