#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::PathBuf, sync::Mutex};
use tauri::{Emitter, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_notification::NotificationExt;
use tempfile::NamedTempFile;
use uuid::Uuid;

mod aiusage;
mod bluetooth;
mod bookmarks;
mod calendar_reminders;
mod chat;
mod control;
mod currency;
mod dashboard;
mod github;
mod health;
mod ics_import;
mod notes;
mod notifs;
mod pomodoro;
mod prayer;
mod radio;
mod screentime;
mod settings;
mod support;
mod teleprompter;
mod translate;

#[derive(Clone, Serialize, Deserialize)]
struct Task {
    id: Uuid,
    text: String,
    done: bool,
    #[serde(default)]
    done_at_ms: Option<u64>,
    #[serde(default)]
    description: String,
    #[serde(default)]
    due_at_ms: Option<u64>,
    #[serde(default)]
    notified_due_at_ms: Option<u64>,
    #[serde(default)]
    repeat: Option<TaskRepeat>,
    #[serde(default)]
    repeated: bool,
    #[serde(default)]
    steps: Vec<TaskStep>,
}

#[derive(Clone, Serialize, Deserialize)]
struct TaskRepeat {
    days: Vec<u8>,
    minute: u16,
}

impl TaskRepeat {
    fn next_due(&self, after_ms: u64) -> Result<u64, String> {
        use chrono::{Datelike, Days, Local, TimeZone, Utc};

        if self.days.is_empty()
            || self.days.len() > 7
            || self.days.iter().any(|day| *day > 6)
            || self.minute >= 1440
        {
            return Err("Choose repeat days and a valid time".into());
        }
        let after = i64::try_from(after_ms)
            .ok()
            .and_then(chrono::DateTime::<Utc>::from_timestamp_millis)
            .ok_or("Repeat date is outside the supported range")?;
        let date = after.with_timezone(&Local).date_naive();
        for day_offset in 0..=14 {
            let Some(day) = date.checked_add_days(Days::new(day_offset)) else {
                break;
            };
            if !self
                .days
                .contains(&(day.weekday().num_days_from_sunday() as u8))
            {
                continue;
            }
            let Some(at) =
                day.and_hms_opt(u32::from(self.minute / 60), u32::from(self.minute % 60), 0)
            else {
                continue;
            };
            // Pick the earlier occurrence on a fall-back day. Skip nonexistent wall-clock times.
            if let Some(due) = Local.from_local_datetime(&at).earliest() {
                if due.timestamp_millis() > after.timestamp_millis() {
                    return Ok(due.timestamp_millis() as u64);
                }
            }
        }
        Err("No upcoming occurrence for this schedule".into())
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct TaskStep {
    id: Uuid,
    text: String,
    done: bool,
}

#[derive(Clone, Serialize, Deserialize)]
struct CalendarEvent {
    id: Uuid,
    title: String,
    start_ms: u64,
    duration_minutes: u32,
    location: String,
    #[serde(default)]
    repeat: EventRepeat,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum EventRepeat {
    #[default]
    None,
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

impl CalendarEvent {
    fn validate(&mut self) -> Result<(), String> {
        self.title = valid_text(std::mem::take(&mut self.title), 200)?;
        valid_due(Some(self.start_ms))?;
        if !(1..=1440).contains(&self.duration_minutes) || self.location.chars().count() > 500 {
            return Err("Invalid event duration or location".into());
        }
        Ok(())
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct WeatherLocation {
    name: String,
    #[serde(default)]
    country: Option<String>,
    #[serde(default)]
    admin1: Option<String>,
    latitude: f64,
    longitude: f64,
}

#[derive(Clone, Serialize, Deserialize)]
struct WorldPlace {
    id: Uuid,
    name: String,
    zone: String,
}

impl WeatherLocation {
    fn validate(&self) -> Result<(), String> {
        if self.name.trim().is_empty()
            || self.name.len() > 160
            || self.country.as_ref().is_some_and(|s| s.len() > 160)
            || self.admin1.as_ref().is_some_and(|s| s.len() > 160)
            || !self.latitude.is_finite()
            || !self.longitude.is_finite()
            || !(-90.0..=90.0).contains(&self.latitude)
            || !(-180.0..=180.0).contains(&self.longitude)
        {
            return Err("Invalid weather location".into());
        }
        Ok(())
    }
}

#[derive(Deserialize)]
struct GeocodingResponse {
    #[serde(default)]
    results: Vec<WeatherLocation>,
}

#[derive(Serialize, Deserialize)]
struct ForecastCurrent {
    temperature_2m: f64,
    relative_humidity_2m: f64,
    weather_code: u32,
    wind_speed_10m: f64,
}

#[derive(Serialize, Deserialize)]
struct ForecastDaily {
    time: Vec<String>,
    temperature_2m_max: Vec<f64>,
    temperature_2m_min: Vec<f64>,
    weather_code: Vec<u32>,
}

#[derive(Serialize, Deserialize)]
struct Forecast {
    current: ForecastCurrent,
    daily: ForecastDaily,
}

#[derive(Serialize)]
struct MediaSnapshot {
    title: String,
    artist: String,
    playing: bool,
    position_ms: Option<u64>,
    duration_ms: Option<u64>,
}

#[derive(Serialize)]
struct SystemSnapshot {
    cpu_percent: Option<f32>,
    memory_used: u64,
    memory_total: u64,
}

struct SystemMonitor {
    system: sysinfo::System,
    last_cpu_sample: std::time::Instant,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
struct Timer {
    total_ms: u64,
    remaining_ms: u64,
    ends_at_ms: Option<u64>,
    notified_end_ms: Option<u64>,
    last_started_minutes: Option<u64>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
struct Stopwatch {
    elapsed_ms: u64,
    started_at_ms: Option<u64>,
    laps: Vec<u64>,
}

impl Stopwatch {
    fn elapsed_at(&self, now: u64) -> u64 {
        self.elapsed_ms.saturating_add(
            self.started_at_ms
                .map_or(0, |start| now.saturating_sub(start)),
        )
    }
}

impl Default for Timer {
    fn default() -> Self {
        Self {
            total_ms: 25 * 60_000,
            remaining_ms: 25 * 60_000,
            ends_at_ms: None,
            notified_end_ms: None,
            last_started_minutes: None,
        }
    }
}

impl Timer {
    fn remaining_at(&self, now: u64) -> u64 {
        self.ends_at_ms
            .map_or(self.remaining_ms, |end| end.saturating_sub(now))
    }
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
struct AppData {
    calendar_reminder_ledger: calendar_reminders::ReminderLedger,
    settings: settings::PoniSettings,
    ai_usage: aiusage::AiUsage,
    chat: chat::ChatData,
    github_login: Option<String>,
    notifications: Vec<notifs::Notification>,
    prayer_settings: Option<prayer::PrayerSettings>,
    radio: radio::RadioData,
    screen_time: screentime::ScreenTime,
    bookmarks: bookmarks::BookmarkData,
    currency: currency::CurrencyData,
    dashboard_widgets: dashboard::DashboardWidgets,
    health: health::Health,
    pomodoro: pomodoro::Pomodoro,
    teleprompter: teleprompter::TeleprompterData,
    tasks: Vec<Task>,
    notes: Vec<notes::Note>,
    timer: Timer,
    stopwatch: Stopwatch,
    weather_location: Option<WeatherLocation>,
    world_clocks: Vec<WorldPlace>,
    calendar_events: Vec<CalendarEvent>,
    hijri_offset: i8,
    wake_minute: Option<u16>,
    bed_minute: Option<u16>,
}

struct Store {
    path: PathBuf,
    data: AppData,
}

#[derive(Default)]
struct WindowSequence {
    session: Option<Uuid>,
    last: u64,
}

struct ShortcutStatus(bool);

impl Store {
    fn open(path: PathBuf) -> Result<Self, String> {
        let data = match fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|e| format!("Cannot read saved data: {e}"))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => AppData::default(),
            Err(e) => return Err(format!("Cannot open saved data: {e}")),
        };
        Ok(Self { path, data })
    }

    fn update(
        &mut self,
        f: impl FnOnce(&mut AppData) -> Result<(), String>,
    ) -> Result<AppData, String> {
        let mut next = self.data.clone();
        f(&mut next)?;
        let parent = self.path.parent().ok_or("Invalid data path")?;
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let mut temp = NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        serde_json::to_writer(&mut temp, &next).map_err(|e| e.to_string())?;
        temp.flush().map_err(|e| e.to_string())?;
        temp.as_file().sync_all().map_err(|e| e.to_string())?;
        temp.persist(&self.path).map_err(|e| e.error.to_string())?;
        self.data = next.clone();
        Ok(next)
    }
}

fn valid_text(text: String, limit: usize) -> Result<String, String> {
    let text = text.trim();
    if text.is_empty() || text.chars().count() > limit {
        return Err(format!("Text must contain 1–{limit} characters"));
    }
    Ok(text.to_owned())
}

fn valid_due(due: Option<u64>) -> Result<(), String> {
    if due.is_some_and(|value| value > 8_640_000_000_000_000) {
        return Err("Due date is outside the supported range".into());
    }
    Ok(())
}

#[tauri::command]
fn get_data(store: State<'_, Mutex<Store>>) -> Result<AppData, String> {
    Ok(store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .data
        .clone())
}

#[tauri::command]
fn set_hijri_offset(store: State<'_, Mutex<Store>>, offset: i8) -> Result<AppData, String> {
    if !(-2..=2).contains(&offset) {
        return Err("Hijri correction must be between -2 and +2 days".into());
    }
    store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            data.hijri_offset = offset;
            Ok(())
        })
}

#[tauri::command]
fn set_day_schedule(
    store: State<'_, Mutex<Store>>,
    wake: u16,
    bed: u16,
) -> Result<AppData, String> {
    if wake >= 1440 || bed >= 1440 || wake == bed {
        return Err("Choose two different valid times".into());
    }
    store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            data.wake_minute = Some(wake);
            data.bed_minute = Some(bed);
            Ok(())
        })
}

#[tauri::command]
fn system_snapshot(system: State<'_, Mutex<SystemMonitor>>) -> Result<SystemSnapshot, String> {
    let mut monitor = system
        .lock()
        .map_err(|_| "System information unavailable")?;
    let cpu = if monitor.last_cpu_sample.elapsed() >= sysinfo::MINIMUM_CPU_UPDATE_INTERVAL {
        monitor.system.refresh_cpu_usage();
        monitor.last_cpu_sample = std::time::Instant::now();
        let value = monitor.system.global_cpu_usage();
        value.is_finite().then_some(value.clamp(0.0, 100.0))
    } else {
        None
    };
    monitor.system.refresh_memory();
    Ok(SystemSnapshot {
        cpu_percent: cpu,
        memory_used: monitor.system.used_memory(),
        memory_total: monitor.system.total_memory(),
    })
}

fn weather_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn search_weather_city(query: String) -> Result<Vec<WeatherLocation>, String> {
    let query = valid_text(query, 100)?;
    if query.chars().count() < 2 {
        return Err("Enter at least two characters".into());
    }
    let response = weather_client()?
        .get("https://geocoding-api.open-meteo.com/v1/search")
        .query(&[("name", query.as_str()), ("count", "5"), ("format", "json")])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json::<GeocodingResponse>()
        .await
        .map_err(|e| e.to_string())?;
    Ok(response
        .results
        .into_iter()
        .filter(|item| item.validate().is_ok())
        .take(5)
        .collect())
}

#[tauri::command]
async fn weather_forecast(location: WeatherLocation) -> Result<Forecast, String> {
    location.validate()?;
    let latitude = location.latitude.to_string();
    let longitude = location.longitude.to_string();
    weather_client()?
        .get("https://api.open-meteo.com/v1/forecast")
        .query(&[
            ("latitude", latitude.as_str()),
            ("longitude", longitude.as_str()),
            (
                "current",
                "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m",
            ),
            (
                "daily",
                "temperature_2m_max,temperature_2m_min,weather_code",
            ),
            ("timezone", "auto"),
            ("forecast_days", "7"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json::<Forecast>()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_weather_location(
    store: State<'_, Mutex<Store>>,
    location: WeatherLocation,
) -> Result<AppData, String> {
    location.validate()?;
    store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            data.weather_location = Some(location);
            Ok(())
        })
}

fn validate_world_clocks(places: &[WorldPlace]) -> Result<(), String> {
    if places.len() > 8 {
        return Err("Choose at most eight places".into());
    }
    let mut ids = std::collections::HashSet::new();
    for place in places {
        if place.name.trim().is_empty()
            || place.name.chars().count() > 30
            || place.zone.len() > 80
            || place.zone.parse::<chrono_tz::Tz>().is_err()
        {
            return Err("Invalid city or time zone".into());
        }
        if !ids.insert(place.id) {
            return Err("Duplicate place identifier".into());
        }
    }
    Ok(())
}

#[tauri::command]
fn set_world_clocks(
    store: State<'_, Mutex<Store>>,
    places: Vec<WorldPlace>,
) -> Result<AppData, String> {
    validate_world_clocks(&places)?;
    store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            data.world_clocks = places;
            Ok(())
        })
}

#[tauri::command]
fn shortcut_status(status: State<'_, ShortcutStatus>) -> bool {
    status.0
}

#[tauri::command]
fn add_task(
    store: State<'_, Mutex<Store>>,
    text: String,
    due_at_ms: Option<u64>,
    repeat: Option<TaskRepeat>,
) -> Result<AppData, String> {
    let text = valid_text(text, 500)?;
    let due_at_ms = task_due(due_at_ms, repeat.as_ref())?;
    store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            data.tasks.push(Task {
                id: Uuid::new_v4(),
                text,
                done: false,
                done_at_ms: None,
                description: String::new(),
                due_at_ms,
                notified_due_at_ms: None,
                repeat,
                repeated: false,
                steps: Vec::new(),
            });
            Ok(())
        })
}

#[tauri::command]
fn update_task(
    store: State<'_, Mutex<Store>>,
    id: Uuid,
    text: String,
    description: String,
    due_at_ms: Option<u64>,
    repeat: Option<TaskRepeat>,
) -> Result<AppData, String> {
    let text = valid_text(text, 500)?;
    let due_at_ms = task_due(due_at_ms, repeat.as_ref())?;
    if description.chars().count() > 10_000 {
        return Err("Description is too long".into());
    }
    store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            let task = data
                .tasks
                .iter_mut()
                .find(|task| task.id == id)
                .ok_or("Task not found")?;
            if task.due_at_ms != due_at_ms {
                task.notified_due_at_ms = None;
            }
            task.text = text;
            task.description = description;
            task.due_at_ms = due_at_ms;
            if task.done && repeat.is_some() {
                return Err("Reopen the task before setting a repeat".into());
            }
            task.repeat = repeat;
            Ok(())
        })
}

fn now_ms() -> Result<u64, String> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .map_err(|_| "Check your computer clock".into())
}

fn task_due(due_at_ms: Option<u64>, repeat: Option<&TaskRepeat>) -> Result<Option<u64>, String> {
    valid_due(due_at_ms)?;
    match repeat {
        Some(schedule) => Ok(Some(schedule.next_due(now_ms()?)?)),
        None => Ok(due_at_ms),
    }
}

fn due_task_time(task: &Task, now: u64) -> Option<u64> {
    let due = task.due_at_ms?;
    (!task.done && due <= now && task.notified_due_at_ms != Some(due)).then_some(due)
}

fn notify_due(app: &tauri::AppHandle, now: u64) {
    let store = app.state::<Mutex<Store>>();
    let Ok(mut store) = store.lock() else { return };
    let due_tasks: Vec<_> = store
        .data
        .tasks
        .iter()
        .filter_map(|task| due_task_time(task, now).map(|due| (task.id, due, task.text.clone())))
        .collect();
    for (id, due, title) in due_tasks {
        if app
            .notification()
            .builder()
            .title("Todo")
            .body(title.as_str())
            .show()
            .is_ok()
        {
            if let Err(error) = store.update(|data| {
                if let Some(task) = data
                    .tasks
                    .iter_mut()
                    .find(|task| task.id == id && task.due_at_ms == Some(due))
                {
                    task.notified_due_at_ms = Some(due);
                    notifs::record(data, notifs::Source::Todo, "Task due", &title, now);
                }
                Ok(())
            }) {
                eprintln!("Could not save reminder state: {error}");
            }
        }
    }
    if unfinished_timer_end(&store.data.timer, now).is_some() {
        let mut finished = None;
        let saved = store.update(|data| {
            finished = finish_timer(data, now);
            Ok(())
        });
        drop(store);
        match saved {
            Ok(_) => announce_timer_end(app, finished),
            Err(error) => eprintln!("Could not save timer reminder state: {error}"),
        }
    }
}

fn unfinished_timer_end(timer: &Timer, now: u64) -> Option<u64> {
    timer
        .ends_at_ms
        .filter(|end| *end <= now && timer.notified_end_ms != Some(*end))
}

fn finish_timer(data: &mut AppData, now: u64) -> Option<bool> {
    let end = unfinished_timer_end(&data.timer, now)?;
    data.timer.notified_end_ms = Some(end);
    notifs::record(data, notifs::Source::Timer, "Timer", "Time is up", now);
    let started_break = data.settings.timer_then_break
        && now.saturating_sub(end) <= 60_000
        && data.pomodoro.start_timer_break(now);
    Some(started_break)
}

fn announce_timer_end(app: &tauri::AppHandle, finished: Option<bool>) {
    let Some(started_break) = finished else {
        return;
    };
    let _ = app
        .notification()
        .builder()
        .title("Timer")
        .body("Time is up")
        .show();
    if started_break {
        let _ = app.emit_to("main", "poni-pomodoro-timer-break", ());
    }
}

#[tauri::command]
fn toggle_task(store: State<'_, Mutex<Store>>, id: Uuid) -> Result<AppData, String> {
    store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            let task = data
                .tasks
                .iter_mut()
                .find(|task| task.id == id)
                .ok_or("Task not found")?;
            let next = complete_or_reopen_task(task, now_ms()?)?;
            if let Some(next) = next {
                data.tasks.insert(0, next);
            }
            Ok(())
        })
}

fn complete_or_reopen_task(task: &mut Task, now: u64) -> Result<Option<Task>, String> {
    if task.repeated {
        return Err("The next occurrence is already in the task list".into());
    }
    let next = task
        .repeat
        .as_ref()
        .map(|schedule| {
            let mut copy = task.clone();
            copy.due_at_ms = Some(schedule.next_due(now.max(task.due_at_ms.unwrap_or(now)))?);
            copy.id = Uuid::new_v4();
            copy.done = false;
            copy.done_at_ms = None;
            copy.notified_due_at_ms = None;
            for step in &mut copy.steps {
                step.done = false;
            }
            Ok::<_, String>(copy)
        })
        .transpose()?;
    task.done = !task.done;
    task.done_at_ms = task.done.then_some(now);
    if next.is_some() {
        task.repeated = true;
        task.repeat = None;
    }
    Ok(next)
}

#[tauri::command]
fn update_task_step(
    store: State<'_, Mutex<Store>>,
    task_id: Uuid,
    step_id: Option<Uuid>,
    action: String,
    text: Option<String>,
) -> Result<AppData, String> {
    store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            let task = data
                .tasks
                .iter_mut()
                .find(|task| task.id == task_id)
                .ok_or("Task not found")?;
            match action.as_str() {
                "add" => {
                    if task.steps.len() >= 100 {
                        return Err("A task can have at most 100 steps".into());
                    }
                    task.steps.push(TaskStep {
                        id: Uuid::new_v4(),
                        text: valid_text(text.unwrap_or_default(), 500)?,
                        done: false,
                    });
                }
                "toggle" | "remove" => {
                    let index = task
                        .steps
                        .iter()
                        .position(|step| Some(step.id) == step_id)
                        .ok_or("Step not found")?;
                    if action == "toggle" {
                        task.steps[index].done = !task.steps[index].done;
                    } else {
                        task.steps.remove(index);
                    }
                }
                _ => return Err("Unknown step action".into()),
            }
            Ok(())
        })
}

#[tauri::command]
fn remove_task(store: State<'_, Mutex<Store>>, id: Uuid) -> Result<AppData, String> {
    store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            let position = data
                .tasks
                .iter()
                .position(|task| task.id == id)
                .ok_or("Task not found")?;
            data.tasks.remove(position);
            Ok(())
        })
}

#[tauri::command]
fn save_calendar_event(
    store: State<'_, Mutex<Store>>,
    id: Option<Uuid>,
    title: String,
    start_ms: u64,
    duration_minutes: u32,
    location: String,
    repeat: EventRepeat,
) -> Result<AppData, String> {
    let mut event = CalendarEvent {
        id: id.unwrap_or_else(Uuid::new_v4),
        title,
        start_ms,
        duration_minutes,
        location,
        repeat,
    };
    event.validate()?;
    store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            if id.is_some() {
                let target = data
                    .calendar_events
                    .iter_mut()
                    .find(|item| item.id == event.id)
                    .ok_or("Event not found")?;
                *target = event;
            } else {
                data.calendar_events.push(event);
            }
            Ok(())
        })
}

#[tauri::command]
fn remove_calendar_event(store: State<'_, Mutex<Store>>, id: Uuid) -> Result<AppData, String> {
    store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            let index = data
                .calendar_events
                .iter()
                .position(|event| event.id == id)
                .ok_or("Event not found")?;
            data.calendar_events.remove(index);
            Ok(())
        })
}

#[tauri::command]
fn timer_action(
    app: tauri::AppHandle,
    store: State<'_, Mutex<Store>>,
    action: String,
    minutes: Option<u32>,
) -> Result<AppData, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64;
    let mut finished = None;
    let result = store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            finished = finish_timer(data, now);
            match action.as_str() {
                "start" => {
                    if data.timer.ends_at_ms.is_none_or(|end| end <= now) {
                        if data.timer.ends_at_ms.is_some() {
                            data.timer.remaining_ms = 0;
                        }
                        if let Some(minutes) = minutes {
                            if !(1..=1439).contains(&minutes) {
                                return Err("Choose 1 to 1439 minutes".into());
                            }
                            data.timer.total_ms = u64::from(minutes) * 60_000;
                            data.timer.remaining_ms = data.timer.total_ms;
                        }
                        if data.timer.remaining_ms == 0 {
                            data.timer.remaining_ms = data.timer.total_ms;
                        }
                        data.timer.ends_at_ms = Some(now.saturating_add(data.timer.remaining_ms));
                        data.timer.last_started_minutes = Some(data.timer.total_ms / 60_000);
                        data.timer.notified_end_ms = None;
                    }
                }
                "pause" => {
                    data.timer.remaining_ms = data.timer.remaining_at(now);
                    data.timer.ends_at_ms = None;
                }
                "reset" => {
                    data.timer.remaining_ms = data.timer.total_ms;
                    data.timer.ends_at_ms = None;
                }
                _ => return Err("Unknown timer action".into()),
            }
            Ok(())
        })?;
    announce_timer_end(&app, finished);
    Ok(result)
}

#[tauri::command]
fn media_control(action: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
            VK_MEDIA_NEXT_TRACK, VK_MEDIA_PLAY_PAUSE, VK_MEDIA_PREV_TRACK,
        };
        let key = match action {
            "previous" => VK_MEDIA_PREV_TRACK,
            "toggle" => VK_MEDIA_PLAY_PAUSE,
            "next" => VK_MEDIA_NEXT_TRACK,
            _ => return Err("Unknown media action".into()),
        };
        let event = |flags| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: key,
                    dwFlags: flags,
                    ..Default::default()
                },
            },
        };
        let inputs = [event(0), event(KEYEVENTF_KEYUP)];
        // Both input records remain valid for the duration of the call.
        let sent = unsafe {
            SendInput(
                inputs.len() as u32,
                inputs.as_ptr(),
                std::mem::size_of::<INPUT>() as i32,
            )
        };
        if sent != inputs.len() as u32 {
            return Err("Windows did not accept the media key".into());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = action;
        Err("Media controls require Windows".into())
    }
}

#[tauri::command]
async fn current_media() -> Result<Option<MediaSnapshot>, String> {
    #[cfg(windows)]
    {
        use windows::Media::Control::{
            GlobalSystemMediaTransportControlsSessionManager,
            GlobalSystemMediaTransportControlsSessionPlaybackStatus,
        };
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(|e| format!("Media manager: {e}"))?
            .await
            .map_err(|e| format!("Media manager: {e}"))?;
        if manager
            .GetSessions()
            .map_err(|e| format!("Media sessions: {e}"))?
            .Size()
            .map_err(|e| format!("Media session count: {e}"))?
            == 0
        {
            return Ok(None);
        }
        let session = match manager.GetCurrentSession() {
            Ok(session) => session,
            Err(error) if error.code().0 == 0 || error.code().0 == 0x80004003u32 as i32 => {
                return Ok(None)
            }
            Err(error) => return Err(format!("Current media session: {error}")),
        };
        let props = session
            .TryGetMediaPropertiesAsync()
            .map_err(|e| e.to_string())?
            .await
            .map_err(|e| e.to_string())?;
        let info = session.GetPlaybackInfo().map_err(|e| e.to_string())?;
        let playing = info.PlaybackStatus().map_err(|e| e.to_string())?
            == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing;
        let timeline = session.GetTimelineProperties().ok();
        let times = timeline.and_then(|value| {
            let start = value.StartTime().ok()?.Duration;
            let end = value.EndTime().ok()?.Duration;
            let position = value.Position().ok()?.Duration;
            let total = end.saturating_sub(start).max(0) as u64 / 10_000;
            let elapsed = position.saturating_sub(start).max(0) as u64 / 10_000;
            Some((elapsed.min(total), total))
        });
        Ok(Some(MediaSnapshot {
            title: props.Title().map_err(|e| e.to_string())?.to_string(),
            artist: props.Artist().map_err(|e| e.to_string())?.to_string(),
            playing,
            position_ms: times.map(|item| item.0),
            duration_ms: times.map(|item| item.1),
        }))
    }
    #[cfg(not(windows))]
    {
        Err("Media information requires Windows".into())
    }
}

#[tauri::command]
fn stopwatch_action(store: State<'_, Mutex<Store>>, action: String) -> Result<AppData, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64;
    store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            let stopwatch = &mut data.stopwatch;
            match action.as_str() {
                "start" => {
                    if stopwatch.started_at_ms.is_none() {
                        stopwatch.started_at_ms = Some(now);
                    }
                }
                "pause" => {
                    stopwatch.elapsed_ms = stopwatch.elapsed_at(now);
                    stopwatch.started_at_ms = None;
                }
                "lap" => {
                    if stopwatch.started_at_ms.is_some() {
                        if stopwatch.laps.len() >= 99 {
                            stopwatch.laps.remove(0);
                        }
                        stopwatch.laps.push(stopwatch.elapsed_at(now));
                    }
                }
                "reset" => *stopwatch = Stopwatch::default(),
                _ => return Err("Unknown stopwatch action".into()),
            }
            Ok(())
        })
}

fn resize_panel(window: &tauri::WebviewWindow, open: bool, tall: bool) -> Result<(), String> {
    let (mut width, mut height): (f64, f64) = match (open, tall) {
        (true, true) => (680.0, 420.0),
        (true, false) => (680.0, 200.0),
        (false, _) => (200.0, 32.0),
    };
    let monitor = window.current_monitor().map_err(|e| e.to_string())?;
    if let Some(monitor) = &monitor {
        let scale = monitor.scale_factor();
        let work = monitor.work_area();
        width = width.min(f64::from(work.size.width) / scale);
        height = height.min(f64::from(work.size.height) / scale);
    }
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    if let Some(monitor) = monitor {
        let physical_width = (width * monitor.scale_factor()).round() as u32;
        let x =
            monitor.position().x + (monitor.size().width.saturating_sub(physical_width) / 2) as i32;
        window
            .set_position(tauri::PhysicalPosition::new(x, monitor.position().y))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn initialize_panel(
    window: tauri::WebviewWindow,
    sequence: State<'_, Mutex<WindowSequence>>,
    session: Uuid,
) -> Result<(), String> {
    let mut state = sequence.lock().map_err(|_| "Window state unavailable")?;
    resize_panel(&window, false, false)?;
    state.session = Some(session);
    state.last = 0;
    Ok(())
}

#[tauri::command]
fn set_panel_open(
    window: tauri::WebviewWindow,
    sequence: State<'_, Mutex<WindowSequence>>,
    session: Uuid,
    open: bool,
    tall: bool,
    focus: bool,
    seq: u64,
) -> Result<(), String> {
    let mut state = sequence.lock().map_err(|_| "Window state unavailable")?;
    if state.session != Some(session) || seq <= state.last {
        return Ok(());
    }
    resize_panel(&window, open, tall)?;
    if open && focus {
        window.set_focus().map_err(|e| e.to_string())?;
    }
    state.last = seq;
    Ok(())
}

#[tauri::command]
async fn open_poni_settings(app: tauri::AppHandle) -> Result<(), String> {
    let window = if let Some(window) = app.get_webview_window("settings") {
        window
    } else {
        tauri::WebviewWindowBuilder::new(
            &app,
            "settings",
            tauri::WebviewUrl::App("settings.html".into()),
        )
        .title("Poni Settings")
        .inner_size(900.0, 700.0)
        .min_inner_size(530.0, 420.0)
        .center()
        .build()
        .map_err(|error| error.to_string())?
    };
    window.show().map_err(|error| error.to_string())?;
    if window.is_minimized().map_err(|error| error.to_string())? {
        window.unminimize().map_err(|error| error.to_string())?;
    }
    window.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
fn show_poni_module(
    app: tauri::AppHandle,
    store: State<'_, Mutex<Store>>,
    module: String,
) -> Result<(), String> {
    let visible = store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .data
        .settings
        .visible(&module);
    if !visible {
        return Err("Enable this module in Settings before opening it".into());
    }
    app.emit_to("main", "poni-settings-open-module", module)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn calendar_first_weekday() -> Option<u8> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Globalization::{GetLocaleInfoEx, LOCALE_IFIRSTDAYOFWEEK};
        let mut value = [0u16; 4];
        let written = unsafe {
            GetLocaleInfoEx(
                std::ptr::null(),
                LOCALE_IFIRSTDAYOFWEEK,
                value.as_mut_ptr(),
                value.len() as i32,
            )
        };
        if written == 2 && (u16::from(b'0')..=u16::from(b'6')).contains(&value[0]) {
            // Windows returns Monday as 0. The calendar renderer uses Sunday as 0.
            return Some(((value[0] - u16::from(b'0') + 1) % 7) as u8);
        }
    }
    None
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state == ShortcutState::Pressed {
                        let _ = app.emit("poni-toggle", ());
                    }
                })
                .build(),
        )
        .setup(|app| {
            let path = app.path().app_data_dir()?.join("data.json");
            let store = Store::open(path).map_err(std::io::Error::other)?;
            app.manage(Mutex::new(store));
            app.manage(Mutex::new(control::ControlState::default()));
            app.manage(Mutex::new(screentime::Tracker::default()));
            let mut system = sysinfo::System::new();
            system.refresh_cpu_usage();
            app.manage(Mutex::new(SystemMonitor {
                system,
                last_cpu_sample: std::time::Instant::now(),
            }));
            app.manage(Mutex::new(WindowSequence::default()));
            app.manage(ShortcutStatus(
                app.global_shortcut().register("Alt+N").is_ok(),
            ));
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                if let Ok(now) = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
                {
                    let now_ms = now.as_millis() as u64;
                    notify_due(&handle, now_ms);
                    pomodoro::tick(&handle, now_ms);
                    calendar_reminders::tick(&handle, now_ms);
                    screentime::sample(&handle);
                }
                std::thread::sleep(std::time::Duration::from_secs(15));
            });
            if let Some(window) = app.get_webview_window("main") {
                if let Some(monitor) = window.current_monitor()? {
                    let size = window.outer_size()?;
                    let x = monitor.position().x
                        + (monitor.size().width.saturating_sub(size.width) / 2) as i32;
                    window.set_position(tauri::PhysicalPosition::new(x, monitor.position().y))?;
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            settings::get_poni_settings,
            open_poni_settings,
            show_poni_module,
            calendar_first_weekday,
            ics_import::import_calendar_ics,
            settings::set_poni_settings,
            settings::remember_poni_module,
            aiusage::ai_usage_state,
            aiusage::import_ai_usage,
            aiusage::clear_ai_usage,
            bluetooth::bluetooth_devices,
            chat::chat_state,
            chat::chat_model,
            chat::chat_select,
            chat::chat_delete,
            chat::chat_send,
            control::control_snapshot,
            control::set_keep_awake,
            control::set_control_volume,
            control::set_control_mute,
            control::open_control_settings,
            github::github_login,
            github::save_github_login,
            github::refresh_github_inbox,
            github::open_github_pull_request,
            notifs::notification_history,
            notifs::update_notification_history,
            prayer::set_prayer_settings,
            prayer::prayer_day,
            radio::get_radio,
            radio::set_radio_preferences,
            radio::update_radio_stations,
            radio::find_radio_stations,
            screentime::screentime_summary,
            screentime::set_screentime_enabled,
            screentime::get_screentime_preferences,
            screentime::set_screentime_preferences,
            screentime::clear_screentime,
            support::open_support_link,
            translate::translate_text,
            bookmarks::list_bookmarks,
            bookmarks::save_bookmark,
            bookmarks::remove_bookmark,
            bookmarks::rename_bookmark_category,
            bookmarks::remove_bookmark_category,
            bookmarks::open_bookmark,
            currency::currency_snapshot,
            currency::refresh_currency_rates,
            currency::save_currency_preferences,
            currency::open_currency_source,
            dashboard::set_dashboard_widgets,
            health::health_state,
            health::health_record,
            pomodoro::pomodoro_state,
            pomodoro::get_pomodoro_settings,
            pomodoro::pomodoro_action,
            pomodoro::pomodoro_settings,
            teleprompter::get_teleprompter,
            teleprompter::save_teleprompter,
            get_data,
            set_hijri_offset,
            set_day_schedule,
            system_snapshot,
            search_weather_city,
            weather_forecast,
            set_weather_location,
            set_world_clocks,
            shortcut_status,
            add_task,
            update_task,
            toggle_task,
            update_task_step,
            remove_task,
            notes::notes_get,
            notes::notes_save,
            notes::notes_delete,
            notes::notes_save_study,
            save_calendar_event,
            remove_calendar_event,
            timer_action,
            media_control,
            current_media,
            stopwatch_action,
            set_panel_open,
            initialize_panel
        ])
        .run(tauri::generate_context!())
        .expect("Could not start Poni Rebuild");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn completing_a_repeat_keeps_history_and_resets_the_next_checklist() {
        use chrono::{Datelike, Local, Timelike, Utc};

        let schedule = TaskRepeat {
            days: vec![1],
            minute: 9 * 60 + 30,
        };
        let now = 1_800_000_000_000;
        let first_due = schedule.next_due(now).unwrap();
        let mut task = Task {
            id: Uuid::new_v4(),
            text: "Weekly review".into(),
            done: false,
            done_at_ms: None,
            description: "Bring notes".into(),
            due_at_ms: Some(first_due),
            notified_due_at_ms: Some(first_due),
            repeat: Some(schedule),
            repeated: false,
            steps: vec![TaskStep {
                id: Uuid::new_v4(),
                text: "Read notes".into(),
                done: true,
            }],
        };
        let next = complete_or_reopen_task(&mut task, now).unwrap().unwrap();
        assert!(task.done && task.repeated && task.steps[0].done);
        assert!(task.repeat.is_none());
        assert!(!next.done && !next.steps[0].done);
        assert_ne!(task.id, next.id);
        assert_eq!(next.description, task.description);
        assert!(next.notified_due_at_ms.is_none());
        let due = next.due_at_ms.unwrap();
        assert!(due > first_due);
        let local = chrono::DateTime::<Utc>::from_timestamp_millis(due as i64)
            .unwrap()
            .with_timezone(&Local);
        assert_eq!(local.weekday().num_days_from_sunday(), 1);
        assert_eq!((local.hour(), local.minute()), (9, 30));
        assert!(complete_or_reopen_task(&mut task, now).is_err());
    }

    #[test]
    fn calendar_event_validation_and_storage() {
        let mut event = CalendarEvent {
            id: Uuid::new_v4(),
            title: "  Meeting  ".into(),
            start_ms: 1_800_000_000_000,
            duration_minutes: 30,
            location: "Office".into(),
            repeat: EventRepeat::None,
        };
        event.validate().unwrap();
        assert_eq!(event.title, "Meeting");
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.json");
        let mut store = Store::open(path.clone()).unwrap();
        store
            .update(|data| {
                data.calendar_events.push(event.clone());
                data.hijri_offset = -2;
                Ok(())
            })
            .unwrap();
        let restored = Store::open(path).unwrap().data;
        assert_eq!(restored.calendar_events[0].title, "Meeting");
        assert_eq!(restored.hijri_offset, -2);
        event.duration_minutes = 0;
        assert!(event.validate().is_err());
        let old_data: AppData = serde_json::from_str(r#"{"tasks":[],"notes":[]}"#).unwrap();
        assert!(old_data.calendar_events.is_empty());
        assert_eq!(old_data.hijri_offset, 0);
        let old_event: CalendarEvent = serde_json::from_str(&format!(
            r#"{{"id":"{}","title":"Old","start_ms":1000,"duration_minutes":30,"location":""}}"#,
            Uuid::new_v4()
        ))
        .unwrap();
        assert!(matches!(old_event.repeat, EventRepeat::None));
    }

    #[test]
    fn persists_updates_and_keeps_original_after_rejected_update() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.json");
        let mut store = Store::open(path.clone()).unwrap();
        store
            .update(|data| {
                data.tasks.push(Task {
                    id: Uuid::new_v4(),
                    text: "First".into(),
                    done: false,
                    done_at_ms: None,
                    description: String::new(),
                    due_at_ms: None,
                    notified_due_at_ms: None,
                    repeat: None,
                    repeated: false,
                    steps: Vec::new(),
                });
                Ok(())
            })
            .unwrap();
        assert!(store
            .update(|data| {
                data.tasks.clear();
                Err("rejected".into())
            })
            .is_err());
        assert_eq!(store.data.tasks.len(), 1);
        store
            .update(|data| {
                data.tasks[0].done = true;
                Ok(())
            })
            .unwrap();
        assert!(Store::open(path.clone()).unwrap().data.tasks[0].done);
        assert_eq!(Store::open(path).unwrap().data.tasks[0].text, "First");
    }

    #[test]
    fn reports_invalid_saved_data_without_overwriting_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.json");
        fs::write(&path, b"broken").unwrap();
        assert!(Store::open(path.clone()).is_err());
        assert_eq!(fs::read(path).unwrap(), b"broken");
    }

    #[test]
    fn timer_remaining_is_saturating_and_defaults_for_old_data() {
        let old: AppData = serde_json::from_str(r#"{"tasks":[],"notes":[]}"#).unwrap();
        assert_eq!(old.timer.remaining_at(1), 25 * 60_000);
        let timer = Timer {
            ends_at_ms: Some(5000),
            ..old.timer
        };
        assert_eq!(timer.remaining_at(3000), 2000);
        assert_eq!(timer.remaining_at(6000), 0);
    }

    #[test]
    fn timer_completes_once_and_starts_only_recent_enabled_breaks() {
        let mut data = AppData::default();
        data.settings.timer_then_break = true;
        data.timer.ends_at_ms = Some(1000);
        assert_eq!(finish_timer(&mut data, 999), None);
        assert_eq!(finish_timer(&mut data, 1000), Some(true));
        assert_eq!(finish_timer(&mut data, 1001), None);
        assert_eq!(data.notifications.len(), 1);

        data.timer.ends_at_ms = Some(2000);
        assert_eq!(finish_timer(&mut data, 2000), Some(false));
        assert_eq!(data.notifications.len(), 2);

        let mut stale = AppData::default();
        stale.settings.timer_then_break = true;
        stale.timer.ends_at_ms = Some(1000);
        assert_eq!(finish_timer(&mut stale, 61_001), Some(false));
        assert!(stale.pomodoro.start_timer_break(61_001));

        let mut disabled = AppData::default();
        disabled.timer.ends_at_ms = Some(1000);
        assert_eq!(finish_timer(&mut disabled, 1000), Some(false));
        assert!(disabled.pomodoro.start_timer_break(1000));
    }

    #[test]
    fn stopwatch_uses_elapsed_time_and_handles_clock_rollback() {
        let sw = Stopwatch {
            elapsed_ms: 500,
            started_at_ms: Some(3000),
            laps: Vec::new(),
        };
        assert_eq!(sw.elapsed_at(5000), 2500);
        assert_eq!(sw.elapsed_at(1000), 500);
    }

    #[test]
    fn older_tasks_load_without_optional_fields() {
        let id = Uuid::new_v4();
        let data = format!(r#"{{"id":"{id}","text":"Older","done":false}}"#);
        let task: Task = serde_json::from_str(&data).unwrap();
        assert!(task.description.is_empty());
        assert!(task.due_at_ms.is_none());
        assert!(valid_due(Some(8_640_000_000_000_000)).is_ok());
        assert!(valid_due(Some(u64::MAX)).is_err());
    }

    #[test]
    fn due_task_is_reported_once_for_its_due_time() {
        let mut task = Task {
            id: Uuid::new_v4(),
            text: "Meeting".into(),
            done: false,
            done_at_ms: None,
            description: String::new(),
            due_at_ms: Some(1000),
            notified_due_at_ms: None,
            repeat: None,
            repeated: false,
            steps: Vec::new(),
        };
        assert_eq!(due_task_time(&task, 999), None);
        assert_eq!(due_task_time(&task, 1000), Some(1000));
        task.notified_due_at_ms = Some(1000);
        assert_eq!(due_task_time(&task, 2000), None);
        task.due_at_ms = Some(3000);
        assert_eq!(due_task_time(&task, 3000), Some(3000));
        task.done = true;
        assert_eq!(due_task_time(&task, 4000), None);
    }

    #[test]
    fn rejects_unknown_media_commands() {
        assert!(media_control("invalid").is_err());
    }

    #[test]
    fn weather_locations_reject_invalid_coordinates_and_allow_missing_region() {
        let city: WeatherLocation =
            serde_json::from_str(r#"{"name":"Jakarta","latitude":-6.2,"longitude":106.8}"#)
                .unwrap();
        assert!(city.validate().is_ok());
        assert!(city.country.is_none());
        let invalid = WeatherLocation {
            latitude: 91.0,
            ..city
        };
        assert!(invalid.validate().is_err());
    }

    #[test]
    fn validates_world_clock_places() {
        let good = WorldPlace {
            id: Uuid::new_v4(),
            name: "Jakarta".into(),
            zone: "Asia/Jakarta".into(),
        };
        assert!(validate_world_clocks(&[good.clone()]).is_ok());
        assert!(validate_world_clocks(&vec![good; 9]).is_err());
        let bad = WorldPlace {
            id: Uuid::new_v4(),
            name: "Unknown".into(),
            zone: "Not/A_Zone".into(),
        };
        assert!(validate_world_clocks(&[bad]).is_err());
    }
}
