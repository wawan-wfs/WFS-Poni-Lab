use super::{notifs, CalendarEvent, EventRepeat, Store};
use chrono::{DateTime, Datelike, Days, Local, NaiveDateTime, Offset, TimeDelta, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;
use uuid::Uuid;

const MINUTE_MS: u64 = 60_000;
const MAX_LEAD_MINUTES: u16 = 30;
const LEDGER_RETENTION_MS: u64 = 3 * 24 * 60 * MINUTE_MS;
const MAX_LEDGER_ENTRIES: usize = 512;
const MAX_NOTIFICATIONS_PER_TICK: usize = 20;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
struct Occurrence {
    start_ms: u64,
    event: Uuid,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(transparent)]
pub(super) struct ReminderLedger(Vec<Occurrence>);

impl ReminderLedger {
    fn retain_recent(&mut self, now_ms: u64) {
        let cutoff = now_ms.saturating_sub(LEDGER_RETENTION_MS);
        self.0.retain(|key| key.start_ms >= cutoff);
        self.0.sort_unstable();
        self.0.dedup();
    }

    fn claim(&mut self, occurrence: Occurrence, now_ms: u64) -> bool {
        let Err(position) = self.0.binary_search(&occurrence) else {
            return false;
        };
        if self.0.len() >= MAX_LEDGER_ENTRIES {
            // Never drop the key for an upcoming event. Wait for room instead of
            // reminding about an already claimed occurrence a second time.
            if self
                .0
                .first()
                .is_none_or(|oldest| oldest.start_ms >= now_ms)
            {
                return false;
            }
            self.0.remove(0);
            self.0.insert(position.saturating_sub(1), occurrence);
        } else {
            self.0.insert(position, occurrence);
        }
        true
    }
}

fn as_utc(ms: u64) -> Option<DateTime<Utc>> {
    DateTime::from_timestamp_millis(i64::try_from(ms).ok()?)
}

pub(super) fn resolve_local<Tz: TimeZone>(
    zone: &Tz,
    wall_time: NaiveDateTime,
) -> Option<DateTime<Tz>> {
    if let Some(instant) = zone.from_local_datetime(&wall_time).earliest() {
        return Some(instant);
    }
    // Match JavaScript Date: in a clock gap, move forward by the size of the
    // gap rather than moving the occurrence to the start of the next hour.
    let before = wall_time.checked_sub_days(Days::new(1))?;
    let offset = zone.offset_from_local_datetime(&before).latest()?.fix();
    let shifted =
        wall_time.checked_sub_signed(TimeDelta::seconds(offset.local_minus_utc().into()))?;
    Some(zone.from_utc_datetime(&shifted))
}

fn upcoming_occurrences<Tz: TimeZone>(
    event: &CalendarEvent,
    zone: &Tz,
    now: &DateTime<Utc>,
    horizon: &DateTime<Utc>,
) -> Vec<Occurrence> {
    let key = |start_ms| Occurrence {
        start_ms,
        event: event.id,
    };
    let now_ms = now.timestamp_millis() as u64;
    let end_ms = horizon.timestamp_millis() as u64;
    if let EventRepeat::None = event.repeat {
        return if (now_ms..=end_ms).contains(&event.start_ms) {
            vec![key(event.start_ms)]
        } else {
            Vec::new()
        };
    }
    if event.start_ms > end_ms {
        return Vec::new();
    }
    let Some(start) = as_utc(event.start_ms).map(|utc| utc.with_timezone(zone)) else {
        return Vec::new();
    };
    let start_date = start.date_naive();
    let today = now.with_timezone(zone).date_naive();
    let last_date = horizon.with_timezone(zone).date_naive();
    // A repeated wall time in a gap near midnight can land the following day.
    let mut date = today
        .min(last_date)
        .pred_opt()
        .unwrap_or(today)
        .max(start_date);
    let last_date = today.max(last_date);
    let mut occurrences = Vec::new();
    while date <= last_date {
        let matches = match event.repeat {
            EventRepeat::None => false,
            EventRepeat::Daily => true,
            EventRepeat::Weekly => date.weekday() == start_date.weekday(),
            EventRepeat::Monthly => date.day() == start_date.day(),
            EventRepeat::Yearly => {
                date.month() == start_date.month() && date.day() == start_date.day()
            }
        };
        if matches {
            let instant = if date == start_date {
                Some(event.start_ms)
            } else {
                resolve_local(zone, date.and_time(start.time()))
                    .and_then(|at| u64::try_from(at.timestamp_millis()).ok())
            };
            if let Some(ms) = instant.filter(|ms| (now_ms..=end_ms).contains(ms)) {
                occurrences.push(key(ms));
            }
        }
        let Some(next_date) = date.succ_opt() else {
            break;
        };
        date = next_date;
    }
    occurrences
}

fn collect_due<'a, Tz: TimeZone>(
    events: &'a [CalendarEvent],
    zone: &Tz,
    now_ms: u64,
    lead: u16,
    ledger: &mut ReminderLedger,
) -> Vec<(Occurrence, &'a str)> {
    if lead == 0 {
        return Vec::new();
    }
    let end_ms = now_ms.saturating_add(u64::from(lead.min(MAX_LEAD_MINUTES)) * MINUTE_MS);
    let (Some(now), Some(horizon)) = (as_utc(now_ms), as_utc(end_ms)) else {
        return Vec::new();
    };
    ledger.retain_recent(now_ms);
    let mut candidates: Vec<_> = events
        .iter()
        .flat_map(|event| {
            upcoming_occurrences(event, zone, &now, &horizon)
                .into_iter()
                .map(move |key| (key, event.title.as_str()))
        })
        .collect();
    candidates.sort_unstable_by_key(|(key, _)| *key);
    candidates
        .into_iter()
        .filter(|(key, _)| ledger.claim(*key, now_ms))
        .take(MAX_NOTIFICATIONS_PER_TICK)
        .collect()
}

pub(super) fn tick(app: &AppHandle, now_ms: u64) {
    let state = app.state::<Mutex<Store>>();
    let Ok(mut store) = state.lock() else { return };
    if !store.data.settings.calendar_enabled || store.data.calendar_events.is_empty() {
        return;
    }
    let mut ledger = store.data.calendar_reminder_ledger.clone();
    let due = collect_due(
        &store.data.calendar_events,
        &Local,
        now_ms,
        store.data.settings.meeting_reminder_minutes,
        &mut ledger,
    );
    if due.is_empty() {
        return;
    }
    let bodies: Vec<_> = due
        .into_iter()
        .map(|(key, title)| {
            let mins = (key.start_ms - now_ms).div_ceil(MINUTE_MS);
            if mins == 0 {
                format!("{title} · now")
            } else {
                format!("{title} · in {mins} min")
            }
        })
        .collect();
    // Keep the reminder in Poni's history even if the OS declines the toast.
    // Atomic reservation and history save also avoid duplicate alerts on restart.
    if let Err(error) = store.update(|data| {
        data.calendar_reminder_ledger = ledger;
        for body in &bodies {
            notifs::record(data, notifs::Source::Calendar, "Calendar", body, now_ms);
        }
        Ok(())
    }) {
        eprintln!("Could not save calendar reminders: {error}");
        return;
    }
    drop(store);

    for body in bodies {
        if let Err(error) = app
            .notification()
            .builder()
            .title("Calendar")
            .body(body)
            .show()
        {
            eprintln!("Could not show a calendar reminder: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono_tz::America::New_York;

    fn utc(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> u64 {
        Utc.with_ymd_and_hms(year, month, day, hour, minute, 0)
            .single()
            .unwrap()
            .timestamp_millis() as u64
    }

    fn event(start_ms: u64, repeat: EventRepeat) -> CalendarEvent {
        CalendarEvent {
            id: Uuid::new_v4(),
            title: "Planning".into(),
            start_ms,
            duration_minutes: 30,
            location: String::new(),
            repeat,
        }
    }

    #[test]
    fn honors_lead_time_ignores_past_events_and_persists_deduplication() {
        let start = utc(2026, 11, 23, 13, 30);
        let events = [
            event(start, EventRepeat::None),
            event(start - 6 * MINUTE_MS, EventRepeat::None),
        ];
        let mut ledger = ReminderLedger::default();
        assert!(collect_due(&events, &Utc, start - 3 * MINUTE_MS, 0, &mut ledger).is_empty());
        assert!(collect_due(&events, &Utc, start - 5 * MINUTE_MS - 1, 5, &mut ledger).is_empty());
        let due = collect_due(&events, &Utc, start - 5 * MINUTE_MS, 5, &mut ledger);
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].0.start_ms, start);

        let saved = serde_json::to_string(&ledger).unwrap();
        let mut restored = serde_json::from_str(&saved).unwrap();
        assert!(collect_due(&events, &Utc, start - MINUTE_MS, 5, &mut restored).is_empty());
        assert!(
            collect_due(&events, &Utc, start + 1, 5, &mut ReminderLedger::default()).is_empty()
        );
    }

    #[test]
    fn repeats_in_local_time_through_spring_gaps_and_fall_folds() {
        let spring = [event(utc(2026, 3, 7, 7, 30), EventRepeat::Daily)];
        let start = utc(2026, 3, 8, 7, 30);
        let mut ledger = ReminderLedger::default();
        let due = collect_due(&spring, &New_York, start - 3 * MINUTE_MS, 5, &mut ledger);
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].0.start_ms, start);

        let fall = [event(utc(2026, 10, 31, 5, 30), EventRepeat::Daily)];
        let first = utc(2026, 11, 1, 5, 30);
        let second = utc(2026, 11, 1, 6, 30);
        assert_eq!(
            collect_due(&fall, &New_York, first, 5, &mut ledger).len(),
            1
        );
        assert!(collect_due(&fall, &New_York, second, 5, &mut ledger).is_empty());
    }

    #[test]
    fn monthly_repeat_skips_short_months_and_lead_spans_midnight() {
        let events = [event(utc(2026, 1, 31, 0, 2), EventRepeat::Monthly)];
        let mut ledger = ReminderLedger::default();
        assert!(collect_due(&events, &Utc, utc(2026, 2, 28, 0, 0), 5, &mut ledger).is_empty());
        let due = collect_due(&events, &Utc, utc(2026, 3, 30, 23, 58), 5, &mut ledger);
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].0.start_ms, utc(2026, 3, 31, 0, 2));
    }

    #[test]
    fn bounds_the_ledger_without_evicting_upcoming_claims() {
        let now = utc(2026, 11, 23, 13, 30);
        let mut ledger = ReminderLedger::default();
        for tick in 0..MAX_LEDGER_ENTRIES {
            assert!(ledger.claim(
                Occurrence {
                    start_ms: now + tick as u64,
                    event: Uuid::nil()
                },
                now
            ));
        }
        let extra = Occurrence {
            start_ms: now + 1000,
            event: Uuid::nil(),
        };
        assert!(!ledger.claim(extra, now));
        assert!(ledger.claim(extra, now + 1));
        assert_eq!(ledger.0.len(), MAX_LEDGER_ENTRIES);
    }
}
