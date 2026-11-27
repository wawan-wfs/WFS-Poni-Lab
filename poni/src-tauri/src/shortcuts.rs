use crate::{settings, Store};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

#[derive(Clone, Deserialize, Serialize)]
#[serde(default)]
pub(super) struct Preferences {
    pub(super) toggle: String,
    snooze: String,
    pub(super) minutes: u16,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            toggle: "Alt+N".into(),
            snooze: String::new(),
            minutes: 30,
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Patch {
    toggle: Option<String>,
    snooze: Option<String>,
    minutes: Option<u16>,
}

#[derive(Clone, Copy, Default)]
pub(super) struct Registered {
    toggle: Option<Shortcut>,
    snooze: Option<Shortcut>,
}

impl Registered {
    fn contains(self, key: Shortcut) -> bool {
        self.toggle == Some(key) || self.snooze == Some(key)
    }

    fn keys(self) -> impl Iterator<Item = Shortcut> {
        [self.toggle, self.snooze].into_iter().flatten()
    }

    pub(super) fn install(app: &AppHandle, preferences: &Preferences) -> Mutex<Self> {
        let try_register = |value: &str| {
            let key = parse(value).ok().flatten()?;
            app.global_shortcut().register(key).ok().map(|()| key)
        };
        Mutex::new(Self {
            toggle: try_register(&preferences.toggle),
            snooze: try_register(&preferences.snooze),
        })
    }
}

fn parse(value: &str) -> Result<Option<Shortcut>, String> {
    if value.is_empty() {
        return Ok(None);
    }
    if value.len() > 64 || value.chars().any(char::is_control) {
        return Err("Enter a shortcut such as Alt+N or Ctrl+Shift+Space".into());
    }
    value
        .parse::<Shortcut>()
        .map(Some)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn shortcut_status(
    registered: State<'_, Mutex<Registered>>,
    store: State<'_, Mutex<Store>>,
) -> bool {
    let configured = store
        .lock()
        .is_ok_and(|store| !store.data.settings.shortcuts.toggle.is_empty());
    !configured
        || registered
            .lock()
            .is_ok_and(|registered| registered.toggle.is_some())
}

pub(super) fn pressed(app: &AppHandle, key: &Shortcut) {
    let Some(state) = app.try_state::<Mutex<Registered>>() else {
        return;
    };
    let Ok(registered) = state.try_lock().map(|value| *value) else {
        return;
    };
    if registered.toggle.as_ref() == Some(key) {
        crate::shortcut_toggle(app, false);
    } else if registered.snooze.as_ref() == Some(key) {
        crate::toggle_snooze(app);
    }
}

#[tauri::command]
pub(super) fn set_poni_shortcuts(
    app: AppHandle,
    registered: State<'_, Mutex<Registered>>,
    store: State<'_, Mutex<Store>>,
    patch: Patch,
) -> Result<settings::PoniSettings, String> {
    let mut registered = registered.lock().map_err(|_| "Shortcuts unavailable")?;
    let mut store = store.lock().map_err(|_| "Storage unavailable")?;
    let mut desired = store.data.settings.shortcuts.clone();
    let old = *registered;
    let mut next = old;
    if let Some(value) = patch.toggle {
        desired.toggle = value.trim().to_owned();
        next.toggle = parse(&desired.toggle)?;
    }
    if let Some(value) = patch.snooze {
        desired.snooze = value.trim().to_owned();
        next.snooze = parse(&desired.snooze)?;
    }
    if next.toggle.is_some() && next.toggle == next.snooze {
        return Err("Choose different shortcuts for opening and snoozing Poni".into());
    }
    if let Some(minutes) = patch.minutes {
        if !(5..=240).contains(&minutes) || minutes % 5 != 0 {
            return Err("Choose a snooze duration between 5 and 240 minutes".into());
        }
        desired.minutes = minutes;
    }
    let global = app.global_shortcut();
    let mut added = Vec::new();
    for key in next
        .keys()
        .filter(|&key| !old.contains(key) && !global.is_registered(key))
    {
        if let Err(error) = global.register(key) {
            for key in added {
                let _ = global.unregister(key);
            }
            return Err(format!("Could not register {key}: {error}"));
        }
        added.push(key);
    }
    let saved = match store.update(|data| {
        data.settings.shortcuts = desired;
        Ok(())
    }) {
        Ok(data) => data.settings,
        Err(error) => {
            for key in added {
                let _ = global.unregister(key);
            }
            return Err(error);
        }
    };
    *registered = next;
    for key in old.keys().filter(|&key| !next.contains(key)) {
        let _ = global.unregister(key);
    }
    drop(store);
    drop(registered);
    settings::publish(&app, &saved);
    Ok(saved)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_disabled_and_rejects_malformed_shortcuts() {
        assert!(parse("").unwrap().is_none());
        assert!(parse("Alt+N").unwrap().is_some());
        assert!(parse("Ctrl+Shift+Space").unwrap().is_some());
        assert!(parse("Ctrl+X+P").is_err());
        assert!(parse("Alt+\nN").is_err());
    }
}
