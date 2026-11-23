use super::{AppData, Store};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

const RETENTION_MS: u64 = 3 * 24 * 60 * 60 * 1000;
const MAX_HISTORY: usize = 200;

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Source {
    Todo,
    Timer,
    Pomodoro,
}

#[derive(Clone, Deserialize, Serialize)]
pub(super) struct Notification {
    id: Uuid,
    source: Source,
    title: String,
    body: String,
    created_at_ms: u64,
    read: bool,
}

pub(super) fn record(data: &mut AppData, source: Source, title: &str, body: &str, now: u64) {
    prune(&mut data.notifications, now);
    data.notifications.insert(
        0,
        Notification {
            id: Uuid::new_v4(),
            source,
            title: title.chars().take(160).collect(),
            body: body.chars().take(500).collect(),
            created_at_ms: now,
            read: false,
        },
    );
    data.notifications.truncate(MAX_HISTORY);
}

fn prune(items: &mut Vec<Notification>, now: u64) {
    let cutoff = now.saturating_sub(RETENTION_MS);
    items.retain(|item| item.created_at_ms >= cutoff);
    items.truncate(MAX_HISTORY);
}

fn now_ms() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|error| error.to_string())
}

pub(super) fn record_for_app(
    app: &AppHandle,
    source: Source,
    title: &str,
    body: &str,
) -> Result<(), String> {
    let now = now_ms()?;
    let state = app.state::<Mutex<Store>>();
    let mut store = state.lock().map_err(|_| "Storage unavailable")?;
    store.update(|data| {
        record(data, source, title, body, now);
        Ok(())
    })?;
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Action {
    Read,
    ReadAll,
    Remove,
    Clear,
}

#[tauri::command]
pub(super) fn notification_history(
    state: State<'_, Mutex<Store>>,
) -> Result<Vec<Notification>, String> {
    let now = now_ms()?;
    let mut store = state.lock().map_err(|_| "Storage unavailable")?;
    let cutoff = now.saturating_sub(RETENTION_MS);
    let items = &store.data.notifications;
    if items.len() <= MAX_HISTORY && items.iter().all(|item| item.created_at_ms >= cutoff) {
        return Ok(items.clone());
    }
    let data = store.update(|data| {
        prune(&mut data.notifications, now);
        Ok(())
    })?;
    Ok(data.notifications)
}

#[tauri::command]
pub(super) fn update_notification_history(
    state: State<'_, Mutex<Store>>,
    action: Action,
    id: Option<Uuid>,
) -> Result<Vec<Notification>, String> {
    let now = now_ms()?;
    let mut store = state.lock().map_err(|_| "Storage unavailable")?;
    let data = store.update(|data| {
        let items = &mut data.notifications;
        prune(items, now);
        match action {
            Action::Read => {
                let id = id.ok_or("Choose a notification")?;
                if let Some(item) = items.iter_mut().find(|item| item.id == id) {
                    item.read = true;
                }
            }
            Action::ReadAll => items.iter_mut().for_each(|item| item.read = true),
            Action::Remove => {
                let id = id.ok_or("Choose a notification")?;
                items.retain(|item| item.id != id);
            }
            Action::Clear => items.clear(),
        }
        Ok(())
    })?;
    Ok(data.notifications)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn history_keeps_latest_entries_and_prunes_expired_items() {
        let mut data = AppData::default();
        record(&mut data, Source::Todo, "Old", "Finished", 1000);
        let recent = RETENTION_MS + 1001;
        for i in 0..=MAX_HISTORY {
            record(
                &mut data,
                Source::Timer,
                &i.to_string(),
                "Time is up",
                recent,
            );
        }
        assert_eq!(data.notifications.len(), MAX_HISTORY);
        assert_eq!(data.notifications[0].title, MAX_HISTORY.to_string());
        assert_eq!(data.notifications.last().unwrap().title, "1");
        assert!(data.notifications.iter().all(|item| !item.read));
        let saved = serde_json::to_string(&data).unwrap();
        let restored: AppData = serde_json::from_str(&saved).unwrap();
        assert_eq!(restored.notifications[0].id, data.notifications[0].id);
    }
}
