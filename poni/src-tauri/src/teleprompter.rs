use super::Store;
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, sync::Mutex};
use tauri::State;
use uuid::Uuid;

#[derive(Clone, Deserialize, Serialize)]
struct Script {
    id: Uuid,
    name: String,
    body: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(default)]
pub(super) struct TeleprompterData {
    scripts: Vec<Script>,
    selected: Option<Uuid>,
    speed: u8,
    size: u8,
    countdown: bool,
}

impl Default for TeleprompterData {
    fn default() -> Self {
        Self {
            scripts: Vec::new(),
            selected: None,
            speed: 10,
            size: 22,
            countdown: true,
        }
    }
}

impl TeleprompterData {
    fn validate(&self) -> Result<(), String> {
        if self.scripts.len() > 30
            || !(1..=20).contains(&self.speed)
            || !(16..=32).contains(&self.size)
        {
            return Err("Invalid teleprompter settings".into());
        }
        let mut ids = HashSet::new();
        for script in &self.scripts {
            if !ids.insert(script.id)
                || script.name.trim().is_empty()
                || script.name.chars().count() > 60
                || script.body.chars().count() > 20_000
            {
                return Err("A script has an invalid name, length or ID".into());
            }
        }
        if self
            .selected
            .map_or(!ids.is_empty(), |id| !ids.contains(&id))
        {
            return Err("The selected script is missing".into());
        }
        Ok(())
    }
}

#[tauri::command]
pub(super) fn get_teleprompter(store: State<'_, Mutex<Store>>) -> Result<TeleprompterData, String> {
    let store = store.lock().map_err(|_| "Storage unavailable")?;
    Ok(store.data.teleprompter.clone())
}

#[tauri::command]
pub(super) fn save_teleprompter(
    store: State<'_, Mutex<Store>>,
    settings: TeleprompterData,
) -> Result<(), String> {
    settings.validate()?;
    store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            data.teleprompter = settings;
            Ok(())
        })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reopening_store_restores_scripts_and_reading_preferences() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        let mut store = Store::open(path.clone()).unwrap();
        let id = Uuid::new_v4();
        let settings = TeleprompterData {
            scripts: vec![Script {
                id,
                name: "Intro".into(),
                body: "[Pause]\nWelcome.".into(),
            }],
            selected: Some(id),
            speed: 15,
            size: 24,
            countdown: false,
        };
        assert!(settings.validate().is_ok());
        store
            .update(|data| {
                data.teleprompter = settings;
                Ok(())
            })
            .unwrap();
        let restored = Store::open(path).unwrap().data.teleprompter;
        assert_eq!(restored.selected, Some(id));
        assert_eq!(restored.scripts[0].body, "[Pause]\nWelcome.");
        assert_eq!(restored.speed, 15);
        assert!(!restored.countdown);
    }
}
