use crate::{calendar_reminders::resolve_local, now_ms, Store};
use chrono::{DateTime, Days, Local, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

const MINUTE_MS: u64 = 60_000;
const MAX_DELAY_MS: u64 = 5 * MINUTE_MS;
const MIN_INTERVAL_MS: u64 = 12 * 60 * MINUTE_MS;
const NOTICE_MS: u64 = 15_000;
pub(super) const DEFAULT_WAKE: u16 = 420;
pub(super) const DEFAULT_BED: u16 = 1380;

#[derive(Clone, Copy, Serialize)]
pub(super) struct Schedule {
    pub(super) wake_minute: u16,
    pub(super) bed_minute: u16,
}

impl Schedule {
    pub(super) fn from_saved(wake: Option<u16>, bed: Option<u16>) -> Self {
        Self {
            wake_minute: wake.unwrap_or(DEFAULT_WAKE),
            bed_minute: bed.unwrap_or(DEFAULT_BED),
        }
    }
}

#[tauri::command]
pub(super) fn get_day_schedule(store: State<'_, Mutex<Store>>) -> Result<Schedule, String> {
    let store = store.lock().map_err(|_| "Storage unavailable")?;
    Ok(Schedule::from_saved(
        store.data.wake_minute,
        store.data.bed_minute,
    ))
}

#[derive(Clone, Copy, Serialize)]
struct Notice {
    scheduled_for_ms: u64,
    expires_at_ms: u64,
}

#[derive(Default)]
pub(super) struct Tracker {
    previous_check: Option<u64>,
    snoozed: Option<(u64, u64)>,
    notice: Option<Notice>,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Action {
    Dismiss,
    Snooze,
}

#[tauri::command]
pub(super) fn bedtime_action(
    store: State<'_, Mutex<Store>>,
    tracker: State<'_, Mutex<Tracker>>,
    action: Action,
    expires_at_ms: u64,
) -> Result<(), String> {
    let now = now_ms()?;
    let mut tracker = tracker.lock().map_err(|_| "Bedtime reminder unavailable")?;
    let notice = tracker
        .notice
        .filter(|notice| notice.expires_at_ms == expires_at_ms && now < expires_at_ms)
        .ok_or("This bedtime reminder has already closed")?;
    let store = store.lock().map_err(|_| "Storage unavailable")?;
    tracker.snoozed = if matches!(action, Action::Snooze) && store.data.settings.bedtime_reminder {
        let delay = u64::from(store.data.settings.todo.snooze_minutes()) * MINUTE_MS;
        Some((now.saturating_add(delay), notice.scheduled_for_ms))
    } else {
        None
    };
    tracker.notice = None;
    Ok(())
}

fn crossed_bedtime<Tz: TimeZone>(
    zone: &Tz,
    previous: u64,
    now: u64,
    minute: u16,
    last_notice: Option<u64>,
) -> Option<u64> {
    if previous >= now || last_notice.is_some_and(|last| now.saturating_sub(last) < MIN_INTERVAL_MS)
    {
        return None;
    }
    let utc = DateTime::<Utc>::from_timestamp_millis(i64::try_from(now).ok()?)?;
    let today = utc.with_timezone(zone).date_naive();
    let time = |date: chrono::NaiveDate| {
        let wall = date.and_hms_opt(u32::from(minute / 60), u32::from(minute % 60), 0)?;
        u64::try_from(resolve_local(zone, wall)?.timestamp_millis()).ok()
    };
    let today_at = time(today)?;
    let when = if today_at <= now {
        today_at
    } else {
        time(today.checked_sub_days(Days::new(1))?)?
    };
    (when > previous && now.saturating_sub(when) <= MAX_DELAY_MS).then_some(when)
}

pub(super) fn tick(app: &AppHandle, now: u64) {
    let tracker = app.state::<Mutex<Tracker>>();
    let Ok(mut tracker) = tracker.lock() else {
        return;
    };
    let previous = tracker.previous_check.replace(now);
    let store = app.state::<Mutex<Store>>();
    let Ok(mut store) = store.lock() else { return };
    if !store.data.settings.bedtime_reminder {
        tracker.snoozed = None;
        tracker.notice = None;
        return;
    }
    let bedtime = store.data.bed_minute.unwrap_or(DEFAULT_BED);
    let scheduled = previous.and_then(|previous| {
        crossed_bedtime(
            &Local,
            previous,
            now,
            bedtime,
            store.data.bedtime_notified_at_ms,
        )
    });
    let snoozed = tracker.snoozed.filter(|(due, _)| *due <= now);
    if snoozed.is_some() {
        tracker.snoozed = None;
    }
    let due = snoozed
        .filter(|(due, _)| now.saturating_sub(*due) <= MAX_DELAY_MS)
        .map(|(_, original)| original)
        .or(scheduled);
    let Some(when) = due.filter(|_| desktop_available()) else {
        return;
    };
    if let Err(error) = store.update(|data| {
        data.bedtime_notified_at_ms = Some(now);
        Ok(())
    }) {
        eprintln!("Could not save bedtime reminder: {error}");
        return;
    }
    let force_chime = store.data.settings.bedtime_chime_dnd;
    let notice = Notice {
        scheduled_for_ms: when,
        expires_at_ms: now.saturating_add(NOTICE_MS),
    };
    tracker.notice = Some(notice);
    drop(store);
    drop(tracker);
    let _ = app.emit_to("main", "poni-bedtime", notice);
    crate::sound::play_bedtime(force_chime);
}

#[cfg(windows)]
fn desktop_available() -> bool {
    use windows_sys::Win32::System::StationsAndDesktops::{
        CloseDesktop, GetUserObjectInformationW, OpenInputDesktop, DESKTOP_READOBJECTS, UOI_NAME,
    };
    unsafe {
        let desktop = OpenInputDesktop(0, 0, DESKTOP_READOBJECTS);
        if desktop.is_null() {
            return false;
        }
        let mut name = [0u16; 64];
        let mut written = 0;
        let ok = GetUserObjectInformationW(
            desktop,
            UOI_NAME,
            name.as_mut_ptr().cast(),
            (name.len() * 2) as u32,
            &mut written,
        );
        CloseDesktop(desktop);
        let length = name
            .iter()
            .position(|unit| *unit == 0)
            .unwrap_or(name.len());
        ok != 0 && String::from_utf16_lossy(&name[..length]).eq_ignore_ascii_case("Default")
    }
}

#[cfg(not(windows))]
fn desktop_available() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_recent_bedtime_crossing_can_remind() {
        let due = Utc
            .with_ymd_and_hms(2026, 11, 24, 23, 0, 0)
            .unwrap()
            .timestamp_millis() as u64;
        let bed = 23 * 60;
        assert_eq!(crossed_bedtime(&Utc, due - 1, due, bed, None), Some(due));
        assert_eq!(crossed_bedtime(&Utc, due, due + 30_000, bed, None), None);
        assert_eq!(
            crossed_bedtime(&Utc, due - 1, due + MAX_DELAY_MS + 1, bed, None),
            None
        );
        assert_eq!(
            crossed_bedtime(&Utc, due - 1, due + 30_000, bed, Some(due - MINUTE_MS)),
            None
        );
    }
}
