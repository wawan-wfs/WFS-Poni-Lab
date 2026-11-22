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

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
struct AppData {
    tasks: Vec<Task>,
    notes: Vec<Note>,
}

struct Store {
    path: PathBuf,
    data: AppData,
}

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

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let path = app.path().app_data_dir()?.join("data.json");
            let store = Store::open(path).map_err(std::io::Error::other)?;
            app.manage(Mutex::new(store));
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
            remove_note
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
}
