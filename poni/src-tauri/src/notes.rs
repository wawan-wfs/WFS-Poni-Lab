use super::Store;
use serde::{Deserialize, Serialize};
use std::{
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

#[derive(Clone, Deserialize, Serialize)]
pub(super) struct Note {
    pub(super) id: Uuid,
    text: String,
    #[serde(default)]
    updated_at: Option<u64>,
    #[serde(default)]
    study: Study,
}

#[derive(Clone, Default, Deserialize, Serialize)]
struct Study {
    shuffle: bool,
    last_round: Option<Round>,
}

#[derive(Clone, Deserialize, Serialize)]
struct Round {
    got: u32,
    of: u32,
    at: u64,
}

#[derive(Deserialize)]
pub(super) struct Score {
    got: u32,
    of: u32,
}

fn now_ms() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|_| "Check your computer clock".into())
}

fn put(notes: &mut Vec<Note>, id: Uuid, text: String, at: u64) -> Result<(), String> {
    if text.len() > 400_000 || text.chars().count() > 100_000 {
        return Err("A note can contain up to 100,000 characters".into());
    }
    if let Some(note) = notes.iter_mut().find(|note| note.id == id) {
        note.text = text;
        note.updated_at = Some(at);
    } else {
        notes.push(Note {
            id,
            text,
            updated_at: Some(at),
            study: Study::default(),
        });
    }
    Ok(())
}

#[tauri::command]
pub(super) fn notes_get(store: State<'_, Mutex<Store>>) -> Result<Vec<Note>, String> {
    let store = store.lock().map_err(|_| "Storage unavailable")?;
    Ok(store.data.notes.clone())
}

#[derive(Serialize)]
pub(super) struct NoteChoice {
    id: Uuid,
    title: String,
}

#[tauri::command]
pub(super) fn note_choices(store: State<'_, Mutex<Store>>) -> Result<Vec<NoteChoice>, String> {
    let store = store.lock().map_err(|_| "Storage unavailable")?;
    Ok(store
        .data
        .notes
        .iter()
        .map(|note| NoteChoice {
            id: note.id,
            title: note
                .text
                .lines()
                .map(str::trim)
                .find(|line| !line.is_empty())
                .unwrap_or("Untitled")
                .chars()
                .take(120)
                .collect(),
        })
        .collect())
}

#[tauri::command]
pub(super) fn notes_save(
    store: State<'_, Mutex<Store>>,
    id: Uuid,
    text: String,
) -> Result<(), String> {
    let at = now_ms()?;
    store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| put(&mut data.notes, id, text, at))?;
    Ok(())
}

#[tauri::command]
pub(super) fn notes_delete(
    app: AppHandle,
    store: State<'_, Mutex<Store>>,
    id: Uuid,
) -> Result<(), String> {
    let mut links_changed = false;
    store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            data.notes.retain(|note| note.id != id);
            for task in data
                .tasks
                .iter_mut()
                .chain(data.trashed_tasks.iter_mut().map(|item| &mut item.task))
            {
                if task.note_id == Some(id) {
                    task.note_id = None;
                    links_changed = true;
                }
            }
            Ok(())
        })?;
    if links_changed {
        let _ = app.emit_to("main", "poni-todo-changed", ());
    }
    Ok(())
}

#[tauri::command]
pub(super) fn notes_save_study(
    store: State<'_, Mutex<Store>>,
    id: Uuid,
    shuffle: bool,
    score: Option<Score>,
) -> Result<(), String> {
    let round = if let Some(score) = score {
        if score.of == 0 || score.of > 100_000 || score.got > score.of {
            return Err("Invalid study score".into());
        }
        Some(Round {
            got: score.got,
            of: score.of,
            at: now_ms()?,
        })
    } else {
        None
    };
    store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            let note = data
                .notes
                .iter_mut()
                .find(|note| note.id == id)
                .ok_or("Note not found")?;
            note.study.shuffle = shuffle;
            if let Some(round) = round {
                note.study.last_round = Some(round);
            }
            Ok(())
        })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_note_retains_id_and_text_when_saved() {
        let id = Uuid::new_v4();
        let legacy = serde_json::json!({"id": id, "text": "Old\n\n"});
        let mut notes = vec![serde_json::from_value::<Note>(legacy).unwrap()];
        assert_eq!(notes[0].text, "Old\n\n");
        assert!(notes[0].updated_at.is_none());
        assert!(!notes[0].study.shuffle);
        put(&mut notes, id, "\n Edited\n\n".into(), 42).unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].id, id);
        assert_eq!(notes[0].text, "\n Edited\n\n");
        assert_eq!(notes[0].updated_at, Some(42));
        put(&mut notes, Uuid::new_v4(), String::new(), 43).unwrap();
        assert_eq!(notes.len(), 2);
    }
}
