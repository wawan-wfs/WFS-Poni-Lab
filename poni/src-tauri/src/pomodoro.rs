use super::Store;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Phase {
    Focus,
    ShortBreak,
    LongBreak,
}

impl Phase {
    fn completed_message(self) -> &'static str {
        match self {
            Self::Focus => "Focus session complete",
            Self::ShortBreak => "Short break complete",
            Self::LongBreak => "Long break complete",
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub(super) struct Settings {
    focus_minutes: u16,
    short_minutes: u16,
    long_minutes: u16,
    cycle_length: u16,
    auto_break: bool,
    auto_focus: bool,
    focus_sound: FocusSound,
    focus_sound_volume: u8,
    focus_sound_breaks: bool,
}

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum FocusSound {
    Off,
    White,
    Pink,
    Brown,
    Rain,
    Waves,
    Wind,
    Fire,
    Cafe,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            focus_minutes: 25,
            short_minutes: 5,
            long_minutes: 15,
            cycle_length: 4,
            auto_break: true,
            auto_focus: false,
            focus_sound: FocusSound::Off,
            focus_sound_volume: 70,
            focus_sound_breaks: false,
        }
    }
}

impl Settings {
    fn validate(&self) -> Result<(), String> {
        if !(5..=90).contains(&self.focus_minutes)
            || !(1..=30).contains(&self.short_minutes)
            || !(5..=60).contains(&self.long_minutes)
            || !(2..=8).contains(&self.cycle_length)
        {
            return Err("Choose valid focus, break, and cycle lengths".into());
        }
        if self.focus_sound_volume > 100 {
            return Err("Choose a sound volume from 0 to 100".into());
        }
        Ok(())
    }

    fn duration(&self, phase: Phase) -> u64 {
        let minutes = match phase {
            Phase::Focus => self.focus_minutes,
            Phase::ShortBreak => self.short_minutes,
            Phase::LongBreak => self.long_minutes,
        };
        u64::from(minutes) * 60_000
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SettingsPatch {
    focus_minutes: Option<u16>,
    short_minutes: Option<u16>,
    long_minutes: Option<u16>,
    cycle_length: Option<u16>,
    auto_break: Option<bool>,
    auto_focus: Option<bool>,
    focus_sound: Option<FocusSound>,
    focus_sound_volume: Option<u8>,
    focus_sound_breaks: Option<bool>,
}

impl SettingsPatch {
    fn apply(self, settings: &mut Settings) -> Result<(), String> {
        settings.focus_minutes = self.focus_minutes.unwrap_or(settings.focus_minutes);
        settings.short_minutes = self.short_minutes.unwrap_or(settings.short_minutes);
        settings.long_minutes = self.long_minutes.unwrap_or(settings.long_minutes);
        settings.cycle_length = self.cycle_length.unwrap_or(settings.cycle_length);
        settings.auto_break = self.auto_break.unwrap_or(settings.auto_break);
        settings.auto_focus = self.auto_focus.unwrap_or(settings.auto_focus);
        settings.focus_sound = self.focus_sound.unwrap_or(settings.focus_sound);
        settings.focus_sound_volume = self
            .focus_sound_volume
            .unwrap_or(settings.focus_sound_volume);
        settings.focus_sound_breaks = self
            .focus_sound_breaks
            .unwrap_or(settings.focus_sound_breaks);
        settings.validate()
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct Completed {
    at_ms: u64,
    focus_ms: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub(super) struct Pomodoro {
    phase: Phase,
    total_ms: u64,
    remaining_ms: u64,
    ends_at_ms: Option<u64>,
    cycle: u16,
    settings: Settings,
    completed: Vec<Completed>,
}

impl Default for Pomodoro {
    fn default() -> Self {
        let settings = Settings::default();
        let total_ms = settings.duration(Phase::Focus);
        Self {
            phase: Phase::Focus,
            total_ms,
            remaining_ms: total_ms,
            ends_at_ms: None,
            cycle: 0,
            settings,
            completed: Vec::new(),
        }
    }
}

impl Pomodoro {
    pub(super) fn start_timer_break(&mut self, now: u64) -> bool {
        if self.ends_at_ms.is_some() {
            return false;
        }
        self.reset(Phase::ShortBreak);
        self.ends_at_ms = Some(now.saturating_add(self.total_ms));
        true
    }

    fn reset(&mut self, phase: Phase) {
        self.phase = phase;
        self.total_ms = self.settings.duration(phase);
        self.remaining_ms = self.total_ms;
        self.ends_at_ms = None;
    }

    fn advance(&mut self, completed_at: Option<u64>, now: u64) {
        let next = match self.phase {
            Phase::Focus => {
                if let Some(at_ms) = completed_at {
                    self.completed.push(Completed {
                        at_ms,
                        focus_ms: self.total_ms,
                    });
                    if self.completed.len() > 512 {
                        self.completed.remove(0);
                    }
                    self.cycle = self.cycle.saturating_add(1);
                }
                if self.cycle >= self.settings.cycle_length {
                    Phase::LongBreak
                } else {
                    Phase::ShortBreak
                }
            }
            Phase::ShortBreak => Phase::Focus,
            Phase::LongBreak => {
                self.cycle = 0;
                Phase::Focus
            }
        };
        self.reset(next);
        // Do not restart focus or breaks on reopening the app long after a session ended.
        let finished_recently = completed_at.is_some_and(|end| now.saturating_sub(end) <= 60_000);
        let auto_start = match self.phase {
            Phase::Focus => self.settings.auto_focus,
            _ => self.settings.auto_break,
        };
        if finished_recently && auto_start {
            self.ends_at_ms = Some(now.saturating_add(self.total_ms));
        }
    }

    fn settle(&mut self, now: u64) -> Option<Phase> {
        let end = self.ends_at_ms.filter(|end| *end <= now)?;
        let phase = self.phase;
        self.advance(Some(end), now);
        Some(phase)
    }

    fn apply(&mut self, action: Action, phase: Option<Phase>, now: u64) -> Result<(), String> {
        match action {
            Action::Toggle => {
                if let Some(end) = self.ends_at_ms.take() {
                    self.remaining_ms = end.saturating_sub(now);
                } else {
                    self.ends_at_ms = Some(now.saturating_add(self.remaining_ms));
                }
            }
            Action::Reset => self.reset(self.phase),
            Action::Skip => self.advance(None, now),
            Action::Phase => self.reset(phase.ok_or("Choose a phase")?),
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Action {
    Toggle,
    Reset,
    Skip,
    Phase,
}

fn now_ms() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|error| error.to_string())
}

fn settle_store(store: &mut Store, now: u64) -> Result<Option<Phase>, String> {
    if store.data.pomodoro.ends_at_ms.is_none_or(|end| end > now) {
        return Ok(None);
    }
    let mut completed = None;
    store.update(|data| {
        completed = data.pomodoro.settle(now);
        Ok(())
    })?;
    Ok(completed)
}

fn notify(app: &AppHandle, phase: Option<Phase>) {
    if let Some(phase) = phase {
        if let Err(error) = super::notifs::record_for_app(
            app,
            super::notifs::Source::Pomodoro,
            "Pomodoro",
            phase.completed_message(),
        ) {
            eprintln!("Could not save Pomodoro notification: {error}");
        }
        let _ = app
            .notification()
            .builder()
            .title("Pomodoro")
            .body(phase.completed_message())
            .show();
    }
}

#[derive(Serialize, Clone)]
pub(super) struct Playback {
    phase: Phase,
    ends_at_ms: Option<u64>,
    focus_sound: FocusSound,
    focus_sound_volume: u8,
    focus_sound_breaks: bool,
}

impl From<&Pomodoro> for Playback {
    fn from(timer: &Pomodoro) -> Self {
        Self {
            phase: timer.phase,
            ends_at_ms: timer.ends_at_ms,
            focus_sound: timer.settings.focus_sound,
            focus_sound_volume: timer.settings.focus_sound_volume,
            focus_sound_breaks: timer.settings.focus_sound_breaks,
        }
    }
}

pub(super) fn send_playback(app: &AppHandle, timer: &Pomodoro) {
    let _ = app.emit_to(
        "main",
        "poni-pomodoro-playback-changed",
        Playback::from(timer),
    );
}

pub(super) fn tick(app: &AppHandle, now: u64) {
    let state = app.state::<Mutex<Store>>();
    let completed = state.lock().ok().and_then(|mut store| {
        let completed = settle_store(&mut store, now).ok().flatten()?;
        send_playback(app, &store.data.pomodoro);
        Some(completed)
    });
    notify(app, completed);
}

#[tauri::command]
pub(super) fn pomodoro_state(
    app: AppHandle,
    state: State<'_, Mutex<Store>>,
) -> Result<Pomodoro, String> {
    let mut store = state.lock().map_err(|_| "Storage unavailable")?;
    let completed = settle_store(&mut store, now_ms()?)?;
    let result = store.data.pomodoro.clone();
    drop(store);
    if completed.is_some() {
        send_playback(&app, &result);
    }
    notify(&app, completed);
    Ok(result)
}

#[tauri::command]
pub(super) fn pomodoro_action(
    app: AppHandle,
    state: State<'_, Mutex<Store>>,
    action: Action,
    phase: Option<Phase>,
) -> Result<Pomodoro, String> {
    let mut store = state.lock().map_err(|_| "Storage unavailable")?;
    let now = now_ms()?;
    let mut completed = None;
    let result = store.update(|data| {
        completed = data.pomodoro.settle(now);
        data.pomodoro.apply(action, phase, now)
    })?;
    drop(store);
    send_playback(&app, &result.pomodoro);
    notify(&app, completed);
    Ok(result.pomodoro)
}

#[tauri::command]
pub(super) fn get_pomodoro_settings(state: State<'_, Mutex<Store>>) -> Result<Settings, String> {
    let store = state.lock().map_err(|_| "Storage unavailable")?;
    Ok(store.data.pomodoro.settings.clone())
}

#[tauri::command]
pub(super) fn get_pomodoro_playback(state: State<'_, Mutex<Store>>) -> Result<Playback, String> {
    let store = state.lock().map_err(|_| "Storage unavailable")?;
    Ok(Playback::from(&store.data.pomodoro))
}

#[tauri::command]
pub(super) fn pomodoro_settings(
    app: AppHandle,
    state: State<'_, Mutex<Store>>,
    settings: SettingsPatch,
) -> Result<Pomodoro, String> {
    let mut store = state.lock().map_err(|_| "Storage unavailable")?;
    let now = now_ms()?;
    let mut completed = None;
    let result = store.update(|data| {
        let timer = &mut data.pomodoro;
        completed = timer.settle(now);
        settings.apply(&mut timer.settings)?;
        if timer.ends_at_ms.is_none() && timer.remaining_ms == timer.total_ms {
            timer.reset(timer.phase);
        }
        Ok(())
    })?;
    drop(store);
    send_playback(&app, &result.pomodoro);
    notify(&app, completed);
    let _ = app.emit("poni-pomodoro-settings-changed", &result.pomodoro.settings);
    Ok(result.pomodoro)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preferences_update_one_field_without_replacing_the_others() {
        let mut settings = Settings {
            short_minutes: 8,
            ..Settings::default()
        };
        let patch: SettingsPatch =
            serde_json::from_str(r#"{"focus_minutes":45,"auto_break":true}"#).unwrap();
        patch.apply(&mut settings).unwrap();
        assert_eq!(settings.focus_minutes, 45);
        assert_eq!(settings.short_minutes, 8);
        assert!(settings.auto_break);
        assert!(!settings.auto_focus);
    }

    #[test]
    fn preserves_paused_time_and_counts_one_completion_per_focus_session() {
        let mut timer = Pomodoro::default();
        timer.settings.cycle_length = 2;
        timer.apply(Action::Toggle, None, 1000).unwrap();
        timer.apply(Action::Toggle, None, 4000).unwrap();
        assert_eq!(timer.remaining_ms, timer.total_ms - 3000);
        let saved = serde_json::to_string(&timer).unwrap();
        let mut timer: Pomodoro = serde_json::from_str(&saved).unwrap();
        let remaining = timer.remaining_ms;
        timer.apply(Action::Toggle, None, 5000).unwrap();
        assert!(matches!(timer.settle(5000 + remaining), Some(Phase::Focus)));
        assert!(timer.settle(5000 + remaining).is_none());
        assert!(matches!(timer.phase, Phase::ShortBreak));
        timer.apply(Action::Skip, None, 2000_000).unwrap();
        timer.apply(Action::Toggle, None, 2000_000).unwrap();
        assert!(timer.settle(2000_000 + timer.total_ms).is_some());
        assert!(matches!(timer.phase, Phase::LongBreak));
        assert_eq!(timer.completed.len(), 2);
    }
}
