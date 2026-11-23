use super::Store;
use chrono::{Local, NaiveDate, Timelike};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, sync::Mutex, time::Instant};
use tauri::{AppHandle, Manager, State};

const RETAIN_DAYS: i64 = 7;

#[derive(Clone, Default, Deserialize, Serialize)]
pub(super) struct ScreenTime {
    enabled: bool,
    days: BTreeMap<NaiveDate, Day>,
}

#[derive(Clone, Default, Deserialize, Serialize)]
struct Day {
    apps: BTreeMap<String, u64>,
    hours: [u64; 24],
    switches: u64,
}

#[derive(Default)]
pub(super) struct Tracker {
    previous: Option<(Instant, String)>,
    pending: BTreeMap<NaiveDate, Day>,
    flush_at: Option<Instant>,
}

#[derive(Serialize)]
pub(super) struct Summary {
    available: bool,
    enabled: bool,
    apps: Vec<(String, u64)>,
    hours: [u64; 24],
    total: u64,
    switches: u64,
}

fn merge(target: &mut Day, source: &Day) {
    for (app, seconds) in &source.apps {
        let key = if target.apps.len() >= 200 && !target.apps.contains_key(app) {
            "Other apps"
        } else {
            app
        };
        *target.apps.entry(key.to_owned()).or_default() += seconds;
    }
    for (slot, seconds) in target.hours.iter_mut().zip(source.hours) {
        *slot += seconds;
    }
    target.switches += source.switches;
}

fn flush(store: &mut Store, tracker: &mut Tracker, today: NaiveDate) -> Result<(), String> {
    if tracker.pending.is_empty() {
        return Ok(());
    }
    store.update(|data| {
        let cutoff = today - chrono::Duration::days(RETAIN_DAYS - 1);
        data.screen_time.days.retain(|date, _| *date >= cutoff);
        for (date, day) in &tracker.pending {
            merge(data.screen_time.days.entry(*date).or_default(), day);
        }
        Ok(())
    })?;
    tracker.pending.clear();
    tracker.flush_at = Some(Instant::now());
    Ok(())
}

#[tauri::command]
pub(super) fn screentime_summary(
    store: State<'_, Mutex<Store>>,
    tracker: State<'_, Mutex<Tracker>>,
    week: bool,
) -> Result<Summary, String> {
    let tracker = tracker.lock().map_err(|_| "Screen Time unavailable")?;
    let store = store.lock().map_err(|_| "Storage unavailable")?;
    let today = Local::now().date_naive();
    let cutoff = today - chrono::Duration::days(if week { RETAIN_DAYS - 1 } else { 0 });
    let mut total = Day::default();
    for (date, day) in store
        .data
        .screen_time
        .days
        .iter()
        .chain(tracker.pending.iter())
    {
        if (cutoff..=today).contains(date) {
            merge(&mut total, day);
        }
    }
    let total_seconds = total.hours.iter().sum();
    let mut apps: Vec<_> = total.apps.into_iter().collect();
    apps.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    Ok(Summary {
        available: cfg!(windows),
        enabled: store.data.screen_time.enabled,
        apps,
        hours: total.hours,
        total: total_seconds,
        switches: total.switches,
    })
}

#[tauri::command]
pub(super) fn set_screentime_enabled(
    store: State<'_, Mutex<Store>>,
    tracker: State<'_, Mutex<Tracker>>,
    enabled: bool,
) -> Result<(), String> {
    if enabled && !cfg!(windows) {
        return Err("Screen Time tracking requires Windows".into());
    }
    let mut tracker = tracker.lock().map_err(|_| "Screen Time unavailable")?;
    let mut store = store.lock().map_err(|_| "Storage unavailable")?;
    flush(&mut store, &mut tracker, Local::now().date_naive())?;
    store.update(|data| {
        data.screen_time.enabled = enabled;
        Ok(())
    })?;
    tracker.previous = None;
    Ok(())
}

#[tauri::command]
pub(super) fn clear_screentime(
    store: State<'_, Mutex<Store>>,
    tracker: State<'_, Mutex<Tracker>>,
) -> Result<(), String> {
    let mut tracker = tracker.lock().map_err(|_| "Screen Time unavailable")?;
    store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            data.screen_time.days.clear();
            Ok(())
        })?;
    *tracker = Tracker::default();
    Ok(())
}

pub(super) fn sample(app: &AppHandle) {
    let tracker = app.state::<Mutex<Tracker>>();
    let Ok(mut tracker) = tracker.lock() else {
        return;
    };
    let store = app.state::<Mutex<Store>>();
    let Ok(mut store) = store.lock() else { return };
    if !store.data.screen_time.enabled {
        return;
    }
    let now = Instant::now();
    let local = Local::now();
    let today = local.date_naive();
    let previous = tracker.previous.take();
    if let Some(name) = active_application() {
        if let Some((since, previous_name)) = previous {
            let seconds = now.saturating_duration_since(since).as_secs();
            if (1..=25).contains(&seconds) {
                let day = tracker.pending.entry(today).or_default();
                day.hours[local.hour() as usize] += seconds;
                *day.apps.entry(previous_name.clone()).or_default() += seconds;
                if name != previous_name {
                    day.switches += 1;
                }
            }
        }
        tracker.previous = Some((now, name));
    }
    let flush_at = *tracker.flush_at.get_or_insert(now);
    if now.saturating_duration_since(flush_at).as_secs() >= 60 {
        if let Err(error) = flush(&mut store, &mut tracker, today) {
            eprintln!("Could not save Screen Time: {error}");
        }
    }
}

#[cfg(windows)]
fn active_application() -> Option<String> {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::{
            SystemInformation::GetTickCount,
            Threading::{
                OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
            },
        },
        UI::{
            Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO},
            WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId},
        },
    };

    // Use only the process's executable name and skip locked or idle sessions.
    unsafe {
        let mut input = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if GetLastInputInfo(&mut input) == 0 || GetTickCount().wrapping_sub(input.dwTime) > 120_000
        {
            return None;
        }
        let window = GetForegroundWindow();
        if window.is_null() {
            return None;
        }
        let mut pid = 0;
        GetWindowThreadProcessId(window, &mut pid);
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return None;
        }
        let mut name = [0_u16; 1024];
        let mut size = name.len() as u32;
        let ok = QueryFullProcessImageNameW(process, 0, name.as_mut_ptr(), &mut size);
        CloseHandle(process);
        if ok == 0 {
            return None;
        }
        let path = String::from_utf16_lossy(&name[..size as usize]);
        let name = std::path::Path::new(&path)
            .file_name()?
            .to_str()?
            .to_lowercase();
        Some(name.chars().take(100).collect())
    }
}

#[cfg(not(windows))]
fn active_application() -> Option<String> {
    None
}
