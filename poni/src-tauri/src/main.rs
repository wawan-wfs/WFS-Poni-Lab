#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::PathBuf, sync::Mutex};
use tauri::{Manager, State};
use tempfile::NamedTempFile;
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize)]
struct Task {
    id: Uuid,
    text: String,
    done: bool,
}

#[derive(Clone, Serialize, Deserialize)]
struct Note {
    id: Uuid,
    text: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
struct Timer {
    total_ms: u64,
    remaining_ms: u64,
    ends_at_ms: Option<u64>,
}

impl Default for Timer {
    fn default() -> Self {
        Self {
            total_ms: 25 * 60_000,
            remaining_ms: 25 * 60_000,
            ends_at_ms: None,
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
    tasks: Vec<Task>,
    notes: Vec<Note>,
    timer: Timer,
}

struct Store {
    path: PathBuf,
    data: AppData,
}

#[derive(Default)]
struct WindowSequence(u64);

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

#[tauri::command]
fn get_data(store: State<'_, Mutex<Store>>) -> Result<AppData, String> {
    Ok(store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .data
        .clone())
}

#[tauri::command]
fn add_task(store: State<'_, Mutex<Store>>, text: String) -> Result<AppData, String> {
    let text = valid_text(text, 500)?;
    store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            data.tasks.push(Task {
                id: Uuid::new_v4(),
                text,
                done: false,
            });
            Ok(())
        })
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
            task.done = !task.done;
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
fn save_note(
    store: State<'_, Mutex<Store>>,
    id: Option<Uuid>,
    text: String,
) -> Result<AppData, String> {
    let text = valid_text(text, 100_000)?;
    store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            match id {
                Some(id) => {
                    data.notes
                        .iter_mut()
                        .find(|note| note.id == id)
                        .ok_or("Note not found")?
                        .text = text
                }
                None => data.notes.push(Note {
                    id: Uuid::new_v4(),
                    text,
                }),
            }
            Ok(())
        })
}

#[tauri::command]
fn remove_note(store: State<'_, Mutex<Store>>, id: Uuid) -> Result<AppData, String> {
    store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            let position = data
                .notes
                .iter()
                .position(|note| note.id == id)
                .ok_or("Note not found")?;
            data.notes.remove(position);
            Ok(())
        })
}

#[tauri::command]
fn timer_action(
    store: State<'_, Mutex<Store>>,
    action: String,
    minutes: Option<u32>,
) -> Result<AppData, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64;
    store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
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
        })
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
fn set_panel_open(
    window: tauri::WebviewWindow,
    sequence: State<'_, Mutex<WindowSequence>>,
    open: bool,
    seq: u64,
) -> Result<(), String> {
    let mut last = sequence.lock().map_err(|_| "Window state unavailable")?;
    if seq <= last.0 {
        return Ok(());
    }
    let (width, height) = if open { (680.0, 200.0) } else { (200.0, 32.0) };
    let monitor = window.current_monitor().map_err(|e| e.to_string())?;
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
    last.0 = seq;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let path = app.path().app_data_dir()?.join("data.json");
            let store = Store::open(path).map_err(std::io::Error::other)?;
            app.manage(Mutex::new(store));
            app.manage(Mutex::new(WindowSequence::default()));
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
            get_data,
            add_task,
            toggle_task,
            remove_task,
            save_note,
            remove_note,
            timer_action,
            media_control,
            set_panel_open
        ])
        .run(tauri::generate_context!())
        .expect("Could not start Poni Rebuild");
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn rejects_unknown_media_commands() {
        assert!(media_control("invalid").is_err());
    }
}
