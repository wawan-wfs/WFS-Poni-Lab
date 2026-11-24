use crate::Store;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

enum Chime {
    Bedtime,
    Completion,
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
    let audio = match chime {
        Chime::Bedtime => BEDTIME.get_or_init(|| synthesize(&[660.0, 880.0])),
        Chime::Completion => COMPLETION.get_or_init(|| synthesize(&[880.0, 1108.7, 1318.5])),
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
fn synthesize(notes: &[f64]) -> Vec<u8> {
    const RATE: u32 = 48_000;
    const NOTE_GAP: u32 = RATE * 16 / 100;
    let frames = RATE + (notes.len() as u32 - 1) * NOTE_GAP;
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
        let mut sample = 0.0;
        for (index, &hz) in notes.iter().enumerate() {
            let Some(elapsed) = frame.checked_sub(index as u32 * NOTE_GAP) else {
                continue;
            };
            if elapsed >= RATE {
                continue;
            }
            let seconds = f64::from(elapsed) / f64::from(RATE);
            let gain = if seconds < 0.02 {
                0.12 * (seconds / 0.02)
            } else {
                0.12 * (0.0001_f64 / 0.12).powf(((seconds - 0.02) / 0.88).min(1.0))
            };
            sample += gain * (std::f64::consts::TAU * hz * seconds).sin();
        }
        bytes.extend_from_slice(&((sample * f64::from(i16::MAX)).round() as i16).to_le_bytes());
    }
    bytes
}

#[cfg(not(windows))]
fn play_chime(_chime: Chime) {}
