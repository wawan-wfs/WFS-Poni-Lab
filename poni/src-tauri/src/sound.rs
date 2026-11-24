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
    let (wave, notes) = match chime {
        Chime::Bedtime => (&BEDTIME, [(0.0, 660.0), (0.16, 880.0)]),
        Chime::Completion => (&COMPLETION, [(0.0, 784.0), (0.20, 1046.5)]),
    };
    let audio = wave.get_or_init(|| {
        const RATE: u32 = 16_000;
        let frames = RATE * 6 / 5;
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
            let time = f64::from(frame) / f64::from(RATE);
            let mut sample = 0.0;
            for (start, hz) in notes {
                let elapsed = time - start;
                if (0.0..1.0).contains(&elapsed) {
                    let gain = (elapsed / 0.02).min(1.0) * (-7.5 * (elapsed - 0.02).max(0.0)).exp();
                    sample += 0.12 * gain * (std::f64::consts::TAU * hz * elapsed).sin();
                }
            }
            bytes.extend_from_slice(&((sample * f64::from(i16::MAX)) as i16).to_le_bytes());
        }
        bytes
    });
    unsafe {
        PlaySoundW(
            audio.as_ptr().cast(),
            std::ptr::null_mut(),
            SND_MEMORY | SND_ASYNC | SND_NODEFAULT,
        );
    }
}

#[cfg(not(windows))]
fn play_chime(_chime: Chime) {}
