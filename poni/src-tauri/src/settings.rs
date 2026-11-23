use crate::Store;
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, sync::Mutex};
use tauri::State;

const MODULES: &[&str] = &[
    "home",
    "tasks",
    "notes",
    "calendar",
    "timer",
    "weather",
    "worldclock",
    "dayprogress",
    "system",
    "bookmarks",
    "pomodoro",
    "teleprompter",
    "dashboard",
    "health",
    "control",
    "github",
    "notifs",
    "prayer",
    "radio",
    "screentime",
    "support",
    "translate",
    "aiusage",
    "bluetooth",
    "chat",
    "currency",
];

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum ClockFormat {
    Region,
    H12,
    H24,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum MirrorShape {
    Rounded,
    Circle,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(default)]
pub(super) struct PoniSettings {
    clock_format: ClockFormat,
    header_clock: bool,
    open_on_hover: bool,
    hover_delay: u16,
    close_delay: u16,
    module_shortcuts: bool,
    mirror_enabled: bool,
    mirror_shape: MirrorShape,
    module_order: Vec<String>,
    hidden_modules: Vec<String>,
    default_module: String,
    remember_module: bool,
    last_module: Option<String>,
}

impl Default for PoniSettings {
    fn default() -> Self {
        Self {
            clock_format: ClockFormat::Region,
            header_clock: true,
            open_on_hover: true,
            hover_delay: 0,
            close_delay: 450,
            module_shortcuts: true,
            mirror_enabled: true,
            mirror_shape: MirrorShape::Rounded,
            module_order: MODULES.iter().map(|id| (*id).to_string()).collect(),
            hidden_modules: Vec::new(),
            default_module: "home".into(),
            remember_module: false,
            last_module: None,
        }
    }
}

#[derive(Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub(super) struct SettingsPatch {
    clock_format: Option<ClockFormat>,
    header_clock: Option<bool>,
    open_on_hover: Option<bool>,
    hover_delay: Option<u16>,
    close_delay: Option<u16>,
    module_shortcuts: Option<bool>,
    mirror_enabled: Option<bool>,
    mirror_shape: Option<MirrorShape>,
    module_order: Option<Vec<String>>,
    hidden_modules: Option<Vec<String>>,
    default_module: Option<String>,
    remember_module: Option<bool>,
}

fn known(id: &str) -> bool {
    MODULES.contains(&id)
}

fn normalize_list(ids: &mut Vec<String>) {
    let mut seen = HashSet::new();
    ids.retain(|id| known(id) && seen.insert(id.clone()));
}

fn valid_module_list(ids: &[String]) -> bool {
    let mut seen = HashSet::new();
    ids.len() <= MODULES.len() && ids.iter().all(|id| known(id) && seen.insert(id))
}

impl PoniSettings {
    fn normalize(&mut self) {
        self.hover_delay = self.hover_delay.min(800);
        self.close_delay = self.close_delay.min(1500);
        normalize_list(&mut self.module_order);
        normalize_list(&mut self.hidden_modules);
        for id in MODULES {
            if !self.module_order.iter().any(|entry| entry == id) {
                self.module_order.push((*id).into());
            }
        }
        if self.hidden_modules.len() == MODULES.len() {
            self.hidden_modules.retain(|id| id != "home");
        }
        if !self.visible(&self.default_module) {
            self.default_module = self
                .module_order
                .iter()
                .find(|id| self.visible(id))
                .cloned()
                .unwrap_or_else(|| "home".into());
        }
        if !self.remember_module
            || self
                .last_module
                .as_ref()
                .is_some_and(|id| !self.visible(id))
        {
            self.last_module = None;
        }
    }

    fn visible(&self, id: &str) -> bool {
        known(id) && self.hidden_modules.iter().all(|hidden| hidden != id)
    }

    fn apply(&mut self, patch: SettingsPatch) -> Result<(), String> {
        if patch.hover_delay.is_some_and(|ms| ms > 800)
            || patch.close_delay.is_some_and(|ms| ms > 1500)
        {
            return Err("Choose a delay within the displayed range".into());
        }
        if patch
            .module_order
            .as_ref()
            .is_some_and(|ids| !valid_module_list(ids))
            || patch
                .hidden_modules
                .as_ref()
                .is_some_and(|ids| !valid_module_list(ids))
        {
            return Err("Unknown or duplicated module".into());
        }
        if patch
            .hidden_modules
            .as_ref()
            .is_some_and(|ids| ids.len() == MODULES.len())
        {
            return Err("Keep at least one module visible".into());
        }
        if let Some(value) = patch.module_order {
            self.module_order = value;
        }
        if let Some(value) = patch.hidden_modules {
            self.hidden_modules = value;
        }
        if let Some(value) = patch.default_module {
            if !self.visible(&value) {
                return Err("Choose a visible module".into());
            }
            self.default_module = value;
        }
        self.clock_format = patch.clock_format.unwrap_or(self.clock_format);
        self.header_clock = patch.header_clock.unwrap_or(self.header_clock);
        self.open_on_hover = patch.open_on_hover.unwrap_or(self.open_on_hover);
        self.hover_delay = patch.hover_delay.unwrap_or(self.hover_delay);
        self.close_delay = patch.close_delay.unwrap_or(self.close_delay);
        self.module_shortcuts = patch.module_shortcuts.unwrap_or(self.module_shortcuts);
        self.mirror_enabled = patch.mirror_enabled.unwrap_or(self.mirror_enabled);
        self.mirror_shape = patch.mirror_shape.unwrap_or(self.mirror_shape);
        self.remember_module = patch.remember_module.unwrap_or(self.remember_module);
        self.normalize();
        Ok(())
    }
}

#[tauri::command]
pub(super) fn get_poni_settings(store: State<'_, Mutex<Store>>) -> Result<PoniSettings, String> {
    let store = store.lock().map_err(|_| "Storage unavailable")?;
    let mut settings = store.data.settings.clone();
    settings.normalize();
    Ok(settings)
}

#[tauri::command]
pub(super) fn set_poni_settings(
    store: State<'_, Mutex<Store>>,
    patch: SettingsPatch,
) -> Result<PoniSettings, String> {
    let mut store = store.lock().map_err(|_| "Storage unavailable")?;
    let updated = store.update(|data| data.settings.apply(patch))?;
    Ok(updated.settings)
}

#[tauri::command]
pub(super) fn remember_poni_module(
    store: State<'_, Mutex<Store>>,
    module: String,
) -> Result<PoniSettings, String> {
    let mut store = store.lock().map_err(|_| "Storage unavailable")?;
    let mut settings = store.data.settings.clone();
    settings.normalize();
    if settings.remember_module
        && settings.visible(&module)
        && settings.last_module.as_deref() != Some(module.as_str())
    {
        settings.last_module = Some(module);
        store.update(|data| {
            data.settings = settings.clone();
            Ok(())
        })?;
    }
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn older_settings_fill_in_modules_and_choose_a_visible_default() {
        let mut settings: PoniSettings = serde_json::from_str(
            r#"{"module_order":["weather","weather"],"hidden_modules":["home"],"default_module":"home","remember_module":true,"last_module":"home"}"#,
        ).unwrap();
        settings.normalize();
        assert_eq!(settings.module_order[0], "weather");
        assert_eq!(settings.module_order.len(), MODULES.len());
        assert_eq!(settings.default_module, "weather");
        assert_eq!(settings.last_module, None);
        assert_eq!(settings.close_delay, 450);
    }

    #[test]
    fn invalid_requests_cannot_remove_all_modules_or_set_an_invalid_delay() {
        let mut settings = PoniSettings::default();
        let all_hidden = SettingsPatch {
            hidden_modules: Some(settings.module_order.clone()),
            ..SettingsPatch::default()
        };
        assert!(settings.apply(all_hidden).is_err());
        assert!(settings.hidden_modules.is_empty());
        let invalid_delay = SettingsPatch {
            hover_delay: Some(999),
            ..SettingsPatch::default()
        };
        assert!(settings.apply(invalid_delay).is_err());
        assert_eq!(settings.hover_delay, 0);
    }
}
