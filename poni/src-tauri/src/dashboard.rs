use super::{AppData, Store};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

#[derive(Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Widget {
    Clock,
    DayProgress,
    UpNext,
    Todo,
    WorldClock,
    System,
    Weather,
    Media,
    Timer,
    Pomodoro,
    Quote,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(transparent)]
pub(super) struct DashboardWidgets([Widget; 4]);

impl Default for DashboardWidgets {
    fn default() -> Self {
        Self([
            Widget::Clock,
            Widget::DayProgress,
            Widget::UpNext,
            Widget::Todo,
        ])
    }
}

#[tauri::command]
pub(super) fn set_dashboard_widgets(
    store: State<'_, Mutex<Store>>,
    widgets: DashboardWidgets,
) -> Result<AppData, String> {
    for (index, widget) in widgets.0.iter().enumerate() {
        if widgets.0[..index].contains(widget) {
            return Err("Choose a different widget for each slot".into());
        }
    }
    store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            data.dashboard_widgets = widgets;
            Ok(())
        })
}
