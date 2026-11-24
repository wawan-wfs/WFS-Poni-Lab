use crate::{complete_or_reopen_task, now_ms, AppData, Store, Task};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

const MINUTE_MS: u64 = 60_000;
const DAY_MS: u64 = 24 * 60 * MINUTE_MS;
const LATE_OPTIONS: [u16; 7] = [0, 1, 3, 5, 10, 30, 60];
const SNOOZE_OPTIONS: [u16; 5] = [5, 10, 15, 30, 60];

#[derive(Clone, Deserialize, Serialize)]
#[serde(default)]
pub(super) struct Preferences {
    late_minutes: u16,
    snooze_minutes: u16,
    trash_days: u16,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            late_minutes: 0,
            snooze_minutes: 10,
            trash_days: 7,
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Patch {
    late_minutes: Option<u16>,
    snooze_minutes: Option<u16>,
    trash_days: Option<u16>,
}

impl Preferences {
    pub(super) fn snooze_minutes(&self) -> u16 {
        self.snooze_minutes
    }

    pub(super) fn apply(&mut self, patch: Patch) -> Result<(), String> {
        validate_late(patch.late_minutes)?;
        if patch
            .snooze_minutes
            .is_some_and(|value| !SNOOZE_OPTIONS.contains(&value))
            || patch
                .trash_days
                .is_some_and(|value| !(1..=30).contains(&value))
        {
            return Err("Choose a supported snooze duration and Trash retention".into());
        }
        self.late_minutes = patch.late_minutes.unwrap_or(self.late_minutes);
        self.snooze_minutes = patch.snooze_minutes.unwrap_or(self.snooze_minutes);
        self.trash_days = patch.trash_days.unwrap_or(self.trash_days);
        Ok(())
    }

    fn late(&self, task: &Task, now: u64) -> bool {
        let minutes = task.late_minutes.unwrap_or(self.late_minutes);
        !task.done
            && minutes > 0
            && task
                .due_at_ms
                .is_some_and(|due| due.saturating_add(u64::from(minutes) * MINUTE_MS) <= now)
    }
}

pub(super) fn validate_late(value: Option<u16>) -> Result<(), String> {
    if value.is_some_and(|value| !LATE_OPTIONS.contains(&value)) {
        return Err("Choose a supported late completion time".into());
    }
    Ok(())
}

#[derive(Clone, Deserialize, Serialize)]
pub(super) struct TrashedTask {
    pub(super) task: Task,
    pub(super) deleted_at_ms: u64,
}

impl TrashedTask {
    fn expired(&self, now: u64, days: u16) -> bool {
        now.saturating_sub(self.deleted_at_ms) >= u64::from(days.clamp(1, 30)) * DAY_MS
    }
}

pub(super) fn trash(data: &mut AppData, index: usize, now: u64) {
    let task = data.tasks.remove(index);
    data.trashed_tasks.push(TrashedTask {
        task,
        deleted_at_ms: now,
    });
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum TrashAction {
    Restore,
    Delete,
    Empty,
    ClearCompleted,
}

fn change_trash(
    data: &mut AppData,
    action: TrashAction,
    id: Option<Uuid>,
    now: u64,
) -> Result<(), String> {
    let days = data.settings.todo.trash_days;
    data.trashed_tasks.retain(|item| !item.expired(now, days));
    match action {
        TrashAction::Empty => data.trashed_tasks.clear(),
        TrashAction::ClearCompleted => {
            let mut active = Vec::new();
            for task in data.tasks.drain(..) {
                if task.done {
                    data.trashed_tasks.push(TrashedTask {
                        task,
                        deleted_at_ms: now,
                    });
                } else {
                    active.push(task);
                }
            }
            data.tasks = active;
        }
        TrashAction::Restore | TrashAction::Delete => {
            let position = data
                .trashed_tasks
                .iter()
                .position(|item| Some(item.task.id) == id)
                .ok_or("Task is no longer in Trash")?;
            let item = data.trashed_tasks.remove(position);
            if matches!(action, TrashAction::Restore) {
                data.tasks.push(item.task);
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub(super) fn change_task_trash(
    store: State<'_, Mutex<Store>>,
    action: TrashAction,
    id: Option<Uuid>,
) -> Result<AppData, String> {
    let now = now_ms()?;
    store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| change_trash(data, action, id, now))
}

fn snooze(task: &mut Task, due_at_ms: u64, now: u64, minutes: u16) -> Result<(), String> {
    if task.done || due_at_ms > now || task.due_at_ms != Some(due_at_ms) {
        return Err("This task is no longer due".into());
    }
    task.due_at_ms = Some(now.saturating_add(u64::from(minutes) * MINUTE_MS));
    task.notified_due_at_ms = None;
    Ok(())
}

#[tauri::command]
pub(super) fn snooze_task(
    store: State<'_, Mutex<Store>>,
    id: Uuid,
    due_at_ms: u64,
) -> Result<AppData, String> {
    let now = now_ms()?;
    store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            let task = data
                .tasks
                .iter_mut()
                .find(|task| task.id == id)
                .ok_or("Task not found")?;
            snooze(task, due_at_ms, now, data.settings.todo.snooze_minutes)
        })
}

fn settle(data: &mut AppData, now: u64) {
    let preferences = &data.settings.todo;
    data.trashed_tasks
        .retain(|item| !item.expired(now, preferences.trash_days));
    let mut next = Vec::new();
    for task in &mut data.tasks {
        if preferences.late(task, now) {
            match complete_or_reopen_task(task, now) {
                Ok(replacement) => {
                    task.auto_done = true;
                    next.extend(replacement);
                }
                Err(error) => eprintln!("Could not complete a late task: {error}"),
            }
        }
    }
    data.tasks.splice(0..0, next);
}

pub(super) fn tick(app: &AppHandle, now: u64) {
    let store = app.state::<Mutex<Store>>();
    let Ok(mut store) = store.lock() else { return };
    let preferences = &store.data.settings.todo;
    if !store
        .data
        .tasks
        .iter()
        .any(|task| preferences.late(task, now))
        && !store
            .data
            .trashed_tasks
            .iter()
            .any(|item| item.expired(now, preferences.trash_days))
    {
        return;
    }
    let result = store.update(|data| {
        settle(data, now);
        Ok(())
    });
    drop(store);
    match result {
        Ok(_) => {
            let _ = app.emit_to("main", "poni-todo-changed", ());
        }
        Err(error) => eprintln!("Could not save Todo state: {error}"),
    }
}

#[derive(Serialize)]
pub(super) struct Snapshot {
    tasks: Vec<Task>,
    trashed_tasks: Vec<TrashedTask>,
}

#[tauri::command]
pub(super) fn get_todo_state(store: State<'_, Mutex<Store>>) -> Result<Snapshot, String> {
    let store = store.lock().map_err(|_| "Storage unavailable")?;
    let now = now_ms()?;
    let days = store.data.settings.todo.trash_days;
    Ok(Snapshot {
        tasks: store.data.tasks.clone(),
        trashed_tasks: store
            .data
            .trashed_tasks
            .iter()
            .filter(|item| !item.expired(now, days))
            .cloned()
            .collect(),
    })
}

#[tauri::command]
pub(super) fn set_task_note(
    store: State<'_, Mutex<Store>>,
    id: Uuid,
    note_id: Option<Uuid>,
) -> Result<AppData, String> {
    store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            if note_id.is_some_and(|id| !data.notes.iter().any(|note| note.id == id)) {
                return Err("The note is no longer available".into());
            }
            let task = data
                .tasks
                .iter_mut()
                .find(|task| task.id == id)
                .ok_or("Task not found")?;
            task.note_id = note_id;
            Ok(())
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(due: u64, override_minutes: Option<u16>) -> Task {
        serde_json::from_value(serde_json::json!({
            "id": Uuid::new_v4(),
            "text": "Weekly plans",
            "done": false,
            "due_at_ms": due,
            "late_minutes": override_minutes
        }))
        .unwrap()
    }

    #[test]
    fn late_repeating_tasks_complete_once_and_never_overrides_the_default() {
        let now = 1_800_000_000_000;
        let due = now - 3 * MINUTE_MS;
        let mut data = AppData::default();
        data.settings.todo.late_minutes = 3;
        let mut repeat = task(due, None);
        repeat.repeat = Some(crate::TaskRepeat {
            days: vec![1],
            minute: 540,
        });
        let repeat_id = repeat.id;
        let protected = task(due, Some(0));
        let protected_id = protected.id;
        data.tasks.extend([repeat, protected]);

        settle(&mut data, now - 1);
        assert_eq!(data.tasks.len(), 2);
        settle(&mut data, now);
        settle(&mut data, now + MINUTE_MS);
        assert_eq!(data.tasks.len(), 3);
        let history = data.tasks.iter().find(|task| task.id == repeat_id).unwrap();
        assert!(history.done && history.auto_done);
        assert!(
            !data
                .tasks
                .iter()
                .find(|task| task.id == protected_id)
                .unwrap()
                .done
        );
        let next = data
            .tasks
            .iter()
            .find(|task| task.repeat.is_some())
            .unwrap();
        assert!(next.due_at_ms.unwrap() > now);
        assert!(!next.done);
    }

    #[test]
    fn snooze_moves_only_the_current_deadline_and_can_be_alerted_again() {
        let due = 1_800_000_000_000;
        let mut task = task(due, Some(3));
        let repeat = crate::TaskRepeat {
            days: vec![3],
            minute: 600,
        };
        task.repeat = Some(repeat.clone());
        task.notified_due_at_ms = Some(due);
        snooze(&mut task, due, due + 1000, 15).unwrap();
        let next = due + 1000 + 15 * MINUTE_MS;
        assert_eq!(task.due_at_ms, Some(next));
        assert_eq!(task.notified_due_at_ms, None);
        assert_eq!(task.late_minutes, Some(3));
        assert!(task.repeat == Some(repeat));
        assert!(snooze(&mut task, due, next, 15).is_err());
        assert_eq!(crate::due_task_time(&task, next), Some(next));
    }

    #[test]
    fn trash_preserves_tasks_until_restored_or_expired() {
        let now = DAY_MS * 100;
        let mut data = AppData::default();
        data.settings.todo.trash_days = 2;
        data.tasks.push(task(now, Some(10)));
        let id = data.tasks[0].id;
        trash(&mut data, 0, now);
        assert!(data.tasks.is_empty());
        assert_eq!(data.trashed_tasks[0].task.id, id);
        change_trash(&mut data, TrashAction::Restore, Some(id), now + DAY_MS).unwrap();
        assert_eq!(data.tasks[0].late_minutes, Some(10));
        trash(&mut data, 0, now);
        settle(&mut data, now + 2 * DAY_MS - 1);
        assert_eq!(data.trashed_tasks.len(), 1);
        settle(&mut data, now + 2 * DAY_MS);
        assert!(data.trashed_tasks.is_empty());
    }
}
