use crate::Store;
use chrono::{DateTime, Local, Timelike, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

enum Chime {
    Bedtime,
    Completion,
    Hourly(bool),
}

#[derive(Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum Mode {
    #[default]
    Off,
    Sound,
    Light,
    Both,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(default)]
pub(super) struct Hourly {
    mode: Mode,
    half: bool,
    quiet: bool,
    from: u16,
    to: u16,
}

impl Default for Hourly {
    fn default() -> Self {
        Self {
            mode: Mode::Off,
            half: false,
            quiet: true,
            from: 22 * 60,
            to: 6 * 60,
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct HourlyPatch {
    mode: Option<Mode>,
    half: Option<bool>,
    quiet: Option<bool>,
    from: Option<u16>,
    to: Option<u16>,
}

impl Hourly {
    pub(super) fn apply(&mut self, patch: HourlyPatch) -> Result<(), String> {
        if patch.from.is_some_and(|value| value >= 1440)
            || patch.to.is_some_and(|value| value >= 1440)
        {
            return Err("Enter quiet hours between midnight and 23:59".into());
        }
        self.mode = patch.mode.unwrap_or(self.mode);
        self.half = patch.half.unwrap_or(self.half);
        self.quiet = patch.quiet.unwrap_or(self.quiet);
        self.from = patch.from.unwrap_or(self.from);
        self.to = patch.to.unwrap_or(self.to);
        Ok(())
    }

    fn quiet_at(&self, minute: u16) -> bool {
        self.quiet
            && match self.from.cmp(&self.to) {
                std::cmp::Ordering::Less => (self.from..self.to).contains(&minute),
                std::cmp::Ordering::Greater => minute >= self.from || minute < self.to,
                std::cmp::Ordering::Equal => false,
            }
    }
}

pub(super) fn hourly_tick(app: &AppHandle, now: u64, last_minute: &mut Option<u64>) {
    use tauri::Emitter;
    let Some(instant) = i64::try_from(now)
        .ok()
        .and_then(DateTime::<Utc>::from_timestamp_millis)
    else {
        return;
    };
    let time = instant.with_timezone(&Local);
    if !matches!(time.minute(), 0 | 30) || time.second() > 20 {
        return;
    }
    let minute = now / 60_000;
    if *last_minute == Some(minute) {
        return;
    }
    *last_minute = Some(minute);
    let state = app.state::<Mutex<Store>>();
    let Ok((settings, panel)) = state.lock().map(|store| {
        (
            store.data.settings.hourly.clone(),
            store.data.settings.panel.clone(),
        )
    }) else {
        return;
    };
    if matches!(settings.mode, Mode::Off)
        || !panel.enabled
        || (!settings.half && time.minute() == 30)
        || settings.quiet_at((time.hour() * 60 + time.minute()) as u16)
    {
        return;
    }
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if !window.is_visible().unwrap_or(false)
        || panel.fullscreen_now(&window)
        || !crate::activity::desktop_available()
    {
        return;
    }
    if matches!(settings.mode, Mode::Light | Mode::Both) {
        let _ = app.emit_to("main", "poni-hour-chime", ());
    }
    if matches!(settings.mode, Mode::Sound | Mode::Both) && notifications_accepted() {
        play_chime(Chime::Hourly(time.minute() == 30));
    }
}

#[tauri::command]
pub(super) fn preview_hourly_chime() {
    play_chime(Chime::Hourly(false));
}

pub(super) fn play_bedtime(override_dnd: bool) {
    if override_dnd || notifications_accepted() {
        play_chime(Chime::Bedtime);
    }
}

pub(super) fn play_completion(app: &AppHandle) {
    let store = app.state::<Mutex<Store>>();
    let enabled = store
        .lock()
        .is_ok_and(|store| store.data.pomodoro.completion_sound_enabled());
    if enabled && notifications_accepted() {
        play_chime(Chime::Completion);
    }
}

#[cfg(windows)]
fn notifications_accepted() -> bool {
    use windows_sys::Win32::UI::Shell::{SHQueryUserNotificationState, QUNS_ACCEPTS_NOTIFICATIONS};
    let mut state = 0;
    unsafe { SHQueryUserNotificationState(&mut state) >= 0 && state == QUNS_ACCEPTS_NOTIFICATIONS }
}

#[cfg(not(windows))]
fn notifications_accepted() -> bool {
    false
}

#[cfg(windows)]
fn play_chime(chime: Chime) {
    use std::sync::OnceLock;
    use windows_sys::Win32::Media::Audio::{PlaySoundW, SND_ASYNC, SND_MEMORY, SND_NODEFAULT};
    static BEDTIME: OnceLock<Vec<u8>> = OnceLock::new();
    static COMPLETION: OnceLock<Vec<u8>> = OnceLock::new();
    static HOURLY: OnceLock<Vec<u8>> = OnceLock::new();
    static HALF: OnceLock<Vec<u8>> = OnceLock::new();
    let audio = match chime {
        Chime::Bedtime => BEDTIME.get_or_init(|| synthesize(&[660.0, 880.0])),
        Chime::Completion => COMPLETION.get_or_init(|| synthesize(&[880.0, 1108.7, 1318.5])),
        Chime::Hourly(false) => HOURLY.get_or_init(|| synthesize_bell(&[659.25, 523.25])),
        Chime::Hourly(true) => HALF.get_or_init(|| synthesize_bell(&[659.25])),
    };
    unsafe {
        PlaySoundW(
            audio.as_ptr().cast(),
            std::ptr::null_mut(),
            SND_MEMORY | SND_ASYNC | SND_NODEFAULT,
        );
    }
}

// Match the sine frequencies and envelope of the Poni 1.8.1 Web Audio chime.
#[cfg(windows)]
const RATE: u32 = 48_000;

#[cfg(windows)]
fn synthesize(notes: &[f64]) -> Vec<u8> {
    const NOTE_GAP: u32 = RATE * 16 / 100;
    let frames = RATE + (notes.len() as u32 - 1) * NOTE_GAP;
    wave(frames, |frame| {
        let mut sample = 0.0;
        for (index, &hz) in notes.iter().enumerate() {
            let Some(elapsed) = frame.checked_sub(index as u32 * NOTE_GAP) else {
                continue;
            };
            if elapsed >= RATE {
                continue;
            }
            let seconds = f64::from(elapsed) / f64::from(RATE);
            sample +=
                ramp(seconds, 0.12, 0.02, 0.90) * (std::f64::consts::TAU * hz * seconds).sin();
        }
        sample
    })
}

#[cfg(windows)]
fn synthesize_bell(notes: &[f64]) -> Vec<u8> {
    let frames =
        ((1.77 + notes.len().saturating_sub(1) as f64 * 0.36) * f64::from(RATE)).ceil() as u32;
    wave(frames, |frame| {
        let now = f64::from(frame) / f64::from(RATE);
        let mut sample = 0.0;
        for (index, base) in notes.iter().enumerate() {
            let elapsed = now - 0.02 - index as f64 * 0.36;
            for (frequency, peak, decay) in [(*base, 0.09, 1.7), (base * 2.76, 0.018, 0.6)] {
                if (0.0..decay + 0.05).contains(&elapsed) {
                    sample += ramp(elapsed, peak, 0.012, decay)
                        * (std::f64::consts::TAU * frequency * elapsed).sin();
                }
            }
        }
        sample
    })
}

#[cfg(windows)]
fn ramp(seconds: f64, peak: f64, rise: f64, decay: f64) -> f64 {
    if seconds < rise {
        peak * seconds / rise
    } else {
        peak * (0.0001_f64 / peak).powf(((seconds - rise) / (decay - rise)).min(1.0))
    }
}

#[cfg(windows)]
fn wave(frames: u32, sample: impl Fn(u32) -> f64) -> Vec<u8> {
    let sample_bytes = frames * 2;
    let mut bytes = b"RIFF".to_vec();
    bytes.extend_from_slice(&(36 + sample_bytes).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&RATE.to_le_bytes());
    bytes.extend_from_slice(&(RATE * 2).to_le_bytes());
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&sample_bytes.to_le_bytes());
    for frame in 0..frames {
        bytes.extend_from_slice(
            &((sample(frame) * f64::from(i16::MAX)).round() as i16).to_le_bytes(),
        );
    }
    bytes
}

#[cfg(not(windows))]
fn play_chime(_chime: Chime) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quiet_hours_across_midnight_include_the_start_and_exclude_the_end() {
        let settings = Hourly::default();
        assert!(!settings.quiet_at(21 * 60 + 59));
        assert!(settings.quiet_at(22 * 60));
        assert!(settings.quiet_at(5 * 60 + 59));
        assert!(!settings.quiet_at(6 * 60));
    }
}
