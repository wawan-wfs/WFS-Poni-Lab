use super::Store;
use chrono::{Local, NaiveDate, Timelike};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    sync::Mutex,
    time::Instant,
};
use tauri::{AppHandle, Emitter, Manager, State};

const RETAIN_DAYS: i64 = 7;

#[derive(Clone, Default, Deserialize, Serialize)]
pub(super) struct ScreenTime {
    #[serde(flatten)]
    preferences: Preferences,
    days: BTreeMap<NaiveDate, Day>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(default)]
pub(super) struct Preferences {
    enabled: bool,
    idle_seconds: u32,
    excluded_apps: Vec<String>,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            enabled: false,
            idle_seconds: 120,
            excluded_apps: Vec::new(),
        }
    }
}

#[derive(Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub(super) struct PreferencesPatch {
    enabled: Option<bool>,
    idle_seconds: Option<u32>,
    excluded_apps: Option<Vec<String>>,
}

impl Preferences {
    fn apply(&mut self, patch: PreferencesPatch) -> Result<(), String> {
        if patch.enabled == Some(true) && !cfg!(windows) {
            return Err("Screen Time tracking requires Windows".into());
        }
        if patch
            .idle_seconds
            .is_some_and(|seconds| !(30..=600).contains(&seconds) || seconds % 30 != 0)
        {
            return Err("Choose an idle limit between 30 and 600 seconds, in steps of 30".into());
        }
        if let Some(entries) = patch.excluded_apps {
            let mut seen = HashSet::new();
            let mut apps = Vec::new();
            for entry in entries {
                let name = entry.trim().to_lowercase();
                if name.is_empty() {
                    continue;
                }
                if name.len() <= 4
                    || name.chars().count() > 100
                    || !name.ends_with(".exe")
                    || name.chars().any(|character| {
                        character.is_control() || r#"<>:"/\|?*,"#.contains(character)
                    })
                {
                    return Err("Enter executable names such as keepass.exe, without paths".into());
                }
                if seen.insert(name.clone()) {
                    apps.push(name);
                }
            }
            if apps.len() > 100 {
                return Err("Exclude up to 100 executable names".into());
            }
            self.excluded_apps = apps;
        }
        self.enabled = patch.enabled.unwrap_or(self.enabled);
        self.idle_seconds = patch.idle_seconds.unwrap_or(self.idle_seconds);
        Ok(())
    }
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
        enabled: store.data.screen_time.preferences.enabled,
        apps,
        hours: total.hours,
        total: total_seconds,
        switches: total.switches,
    })
}

#[tauri::command]
pub(super) fn set_screentime_enabled(
    app: AppHandle,
    store: State<'_, Mutex<Store>>,
    tracker: State<'_, Mutex<Tracker>>,
    enabled: bool,
) -> Result<(), String> {
    let preferences = update_preferences(
        &store,
        &tracker,
        PreferencesPatch {
            enabled: Some(enabled),
            ..PreferencesPatch::default()
        },
    )?;
    let _ = app.emit_to("settings", "poni-screentime-changed", preferences);
    Ok(())
}

#[tauri::command]
pub(super) fn get_screentime_preferences(
    store: State<'_, Mutex<Store>>,
) -> Result<Preferences, String> {
    let store = store.lock().map_err(|_| "Storage unavailable")?;
    Ok(store.data.screen_time.preferences.clone())
}

#[tauri::command]
pub(super) fn set_screentime_preferences(
    app: AppHandle,
    store: State<'_, Mutex<Store>>,
    tracker: State<'_, Mutex<Tracker>>,
    patch: PreferencesPatch,
) -> Result<Preferences, String> {
    let preferences = update_preferences(&store, &tracker, patch)?;
    let _ = app.emit_to("main", "poni-screentime-changed", &preferences);
    Ok(preferences)
}

fn update_preferences(
    store: &Mutex<Store>,
    tracker: &Mutex<Tracker>,
    patch: PreferencesPatch,
) -> Result<Preferences, String> {
    let mut tracker = tracker.lock().map_err(|_| "Screen Time unavailable")?;
    let mut store = store.lock().map_err(|_| "Storage unavailable")?;
    let mut preferences = store.data.screen_time.preferences.clone();
    preferences.apply(patch)?;
    flush(&mut store, &mut tracker, Local::now().date_naive())?;
    store.update(|data| {
        data.screen_time.preferences = preferences.clone();
        Ok(())
    })?;
    tracker.previous = None;
    Ok(preferences)
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
    let preferences = &store.data.screen_time.preferences;
    if !preferences.enabled {
        return;
    }
    let now = Instant::now();
    let local = Local::now();
    let today = local.date_naive();
    let previous = tracker.previous.take();
    if let Some(name) = active_application(preferences.idle_seconds)
        .filter(|name| !preferences.excluded_apps.contains(name))
    {
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
fn active_application(idle_seconds: u32) -> Option<String> {
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
        if GetLastInputInfo(&mut input) == 0
            || GetTickCount().wrapping_sub(input.dwTime) > idle_seconds.saturating_mul(1000)
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
fn active_application(_idle_seconds: u32) -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn previous_tracking_data_gets_defaults_without_losing_usage() {
        let data: ScreenTime = serde_json::from_str(
            r#"{"enabled":true,"days":{"2026-11-20":{"apps":{"notepad.exe":12},"hours":[12,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"switches":0}}}"#,
        ).unwrap();
        assert!(data.preferences.enabled);
        assert_eq!(data.preferences.idle_seconds, 120);
        assert!(data.preferences.excluded_apps.is_empty());
        let saved = serde_json::to_value(&data).unwrap();
        assert_eq!(saved["enabled"], true);
        assert_eq!(saved["days"]["2026-11-20"]["apps"]["notepad.exe"], 12);
    }

    #[test]
    fn idle_threshold_and_exclusions_are_validated_before_saving() {
        let mut preferences = Preferences::default();
        preferences
            .apply(PreferencesPatch {
                idle_seconds: Some(600),
                excluded_apps: Some(vec![" Steam.EXE ".into(), "".into(), "steam.exe".into()]),
                ..PreferencesPatch::default()
            })
            .unwrap();
        assert_eq!(preferences.idle_seconds, 600);
        assert_eq!(preferences.excluded_apps, ["steam.exe"]);
        assert!(preferences
            .apply(PreferencesPatch {
                idle_seconds: Some(31),
                ..PreferencesPatch::default()
            })
            .is_err());
        assert!(preferences
            .apply(PreferencesPatch {
                excluded_apps: Some(vec![r"C:\Steam\steam.exe".into()]),
                ..PreferencesPatch::default()
            })
            .is_err());
        assert_eq!(preferences.idle_seconds, 600);
        assert_eq!(preferences.excluded_apps, ["steam.exe"]);
    }
}
