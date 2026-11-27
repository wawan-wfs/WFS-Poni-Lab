use crate::{battery, bluetooth, health, panel, shelf, shortcuts, sound, todo, Store};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, sync::Mutex};
use tauri::{AppHandle, Emitter, State};

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
    "shelf",
    "currency",
];

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum ClockFormat {
    Region,
    H12,
    H24,
}

#[derive(Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum ClosedClockMode {
    #[default]
    Time,
    Date,
    Off,
}

#[derive(Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum ClosedClockSize {
    Small,
    #[default]
    Normal,
    Large,
    Xlarge,
}

#[derive(Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum ClosedSlot {
    #[default]
    None,
    Weather,
    Battery,
    Date,
    Event,
    Todo,
    Time,
    Cpu,
    Ram,
    World,
    Disk,
    Wifi,
    Net,
    Download,
    Upload,
    Prayer,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(default)]
struct ClosedDisplay {
    mode: ClosedClockMode,
    size: ClosedClockSize,
    bold: bool,
    left: ClosedSlot,
    right: ClosedSlot,
}

impl Default for ClosedDisplay {
    fn default() -> Self {
        Self {
            mode: ClosedClockMode::Time,
            size: ClosedClockSize::Normal,
            bold: false,
            left: ClosedSlot::None,
            right: ClosedSlot::Battery,
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ClosedDisplayPatch {
    mode: Option<ClosedClockMode>,
    size: Option<ClosedClockSize>,
    bold: Option<bool>,
    left: Option<ClosedSlot>,
    right: Option<ClosedSlot>,
}

impl ClosedDisplay {
    fn apply(&mut self, patch: ClosedDisplayPatch) {
        self.mode = patch.mode.unwrap_or(self.mode);
        self.size = patch.size.unwrap_or(self.size);
        self.bold = patch.bold.unwrap_or(self.bold);
        self.left = patch.left.unwrap_or(self.left);
        self.right = patch.right.unwrap_or(self.right);
    }
}

fn clean_name(value: &str) -> String {
    let collapsed = value.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed
        .chars()
        .filter(|character| !character.is_control())
        .take(40)
        .collect::<String>()
        .trim_end()
        .to_owned()
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum MirrorShape {
    Rounded,
    Circle,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum WeekStart {
    Windows,
    Monday,
    Sunday,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(default)]
struct LiveActivities {
    enabled: bool,
    rotate: bool,
    timers: bool,
    calendar: bool,
    bluetooth: bool,
    todo: bool,
    music: bool,
    system: bool,
    system_interval: u16,
    sneak_peek: bool,
    hover_media_controls: bool,
}

impl Default for LiveActivities {
    fn default() -> Self {
        Self {
            enabled: true,
            rotate: true,
            timers: true,
            calendar: true,
            bluetooth: true,
            todo: true,
            music: true,
            system: false,
            system_interval: 120,
            sneak_peek: false,
            hover_media_controls: false,
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LiveActivitiesPatch {
    enabled: Option<bool>,
    rotate: Option<bool>,
    timers: Option<bool>,
    calendar: Option<bool>,
    bluetooth: Option<bool>,
    todo: Option<bool>,
    music: Option<bool>,
    system: Option<bool>,
    system_interval: Option<u16>,
    sneak_peek: Option<bool>,
    hover_media_controls: Option<bool>,
}

impl LiveActivities {
    fn apply(&mut self, patch: LiveActivitiesPatch) -> Result<(), String> {
        if patch
            .system_interval
            .is_some_and(|value| ![30, 60, 120, 300, 600, 1800].contains(&value))
        {
            return Err("Choose a system summary interval from Settings".into());
        }
        self.enabled = patch.enabled.unwrap_or(self.enabled);
        self.rotate = patch.rotate.unwrap_or(self.rotate);
        self.timers = patch.timers.unwrap_or(self.timers);
        self.calendar = patch.calendar.unwrap_or(self.calendar);
        self.bluetooth = patch.bluetooth.unwrap_or(self.bluetooth);
        self.todo = patch.todo.unwrap_or(self.todo);
        self.music = patch.music.unwrap_or(self.music);
        self.system = patch.system.unwrap_or(self.system);
        self.system_interval = patch.system_interval.unwrap_or(self.system_interval);
        self.sneak_peek = patch.sneak_peek.unwrap_or(self.sneak_peek);
        self.hover_media_controls = patch
            .hover_media_controls
            .unwrap_or(self.hover_media_controls);
        Ok(())
    }
}

#[derive(Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum NotchShadow {
    Always,
    Opening,
    #[default]
    Off,
}

#[derive(Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum PowerSaving {
    #[default]
    Off,
    Auto,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(default)]
struct Animations {
    timer_outline: bool,
    shelf_fly: bool,
    tab_slide: bool,
    shadow: NotchShadow,
    celebrate: bool,
}

impl Default for Animations {
    fn default() -> Self {
        Self {
            timer_outline: true,
            shelf_fly: true,
            tab_slide: true,
            shadow: NotchShadow::Off,
            celebrate: true,
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AnimationsPatch {
    timer_outline: Option<bool>,
    shelf_fly: Option<bool>,
    tab_slide: Option<bool>,
    shadow: Option<NotchShadow>,
    celebrate: Option<bool>,
}

impl Animations {
    fn apply(&mut self, patch: AnimationsPatch) {
        self.timer_outline = patch.timer_outline.unwrap_or(self.timer_outline);
        self.shelf_fly = patch.shelf_fly.unwrap_or(self.shelf_fly);
        self.tab_slide = patch.tab_slide.unwrap_or(self.tab_slide);
        self.shadow = patch.shadow.unwrap_or(self.shadow);
        self.celebrate = patch.celebrate.unwrap_or(self.celebrate);
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(default)]
pub(super) struct PoniSettings {
    pub(super) user_name: String,
    closed_display: ClosedDisplay,
    clock_format: ClockFormat,
    clock_with_activities: bool,
    media_enabled: bool,
    music_progress: bool,
    color_glow: bool,
    haptics: bool,
    battery_saving: PowerSaving,
    pub(super) hourly: sound::Hourly,
    animations: Animations,
    header_clock: bool,
    open_on_hover: bool,
    hover_delay: u16,
    close_delay: u16,
    module_shortcuts: bool,
    mirror_enabled: bool,
    mirror_shape: MirrorShape,
    pub(super) calendar_enabled: bool,
    pub(super) meeting_reminder_minutes: u16,
    pub(super) week_start: WeekStart,
    pub(super) timer_presets: Vec<u16>,
    pub(super) timer_remember: bool,
    pub(super) timer_then_break: bool,
    pub(super) panel: panel::Preferences,
    pub(super) shortcuts: shortcuts::Preferences,
    pub(super) todo: todo::Preferences,
    pub(super) health: health::Preferences,
    battery: battery::Preferences,
    bluetooth: bluetooth::Preferences,
    live: LiveActivities,
    pub(super) shelf: shelf::Preferences,
    pub(super) bedtime_reminder: bool,
    pub(super) bedtime_chime_dnd: bool,
    module_order: Vec<String>,
    hidden_modules: Vec<String>,
    default_module: String,
    remember_module: bool,
    last_module: Option<String>,
}

impl Default for PoniSettings {
    fn default() -> Self {
        Self {
            user_name: String::new(),
            closed_display: ClosedDisplay::default(),
            clock_format: ClockFormat::Region,
            clock_with_activities: true,
            media_enabled: true,
            music_progress: true,
            color_glow: true,
            haptics: true,
            battery_saving: PowerSaving::Off,
            hourly: sound::Hourly::default(),
            animations: Animations::default(),
            header_clock: true,
            open_on_hover: true,
            hover_delay: 0,
            close_delay: 450,
            module_shortcuts: true,
            mirror_enabled: true,
            mirror_shape: MirrorShape::Rounded,
            calendar_enabled: true,
            meeting_reminder_minutes: 5,
            week_start: WeekStart::Windows,
            timer_presets: Vec::new(),
            timer_remember: true,
            timer_then_break: false,
            panel: panel::Preferences::default(),
            shortcuts: shortcuts::Preferences::default(),
            todo: todo::Preferences::default(),
            health: health::Preferences::default(),
            battery: battery::Preferences::default(),
            bluetooth: bluetooth::Preferences::default(),
            live: LiveActivities::default(),
            shelf: shelf::Preferences::default(),
            bedtime_reminder: false,
            bedtime_chime_dnd: false,
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
    user_name: Option<String>,
    closed_display: Option<ClosedDisplayPatch>,
    clock_format: Option<ClockFormat>,
    clock_with_activities: Option<bool>,
    media_enabled: Option<bool>,
    music_progress: Option<bool>,
    color_glow: Option<bool>,
    haptics: Option<bool>,
    battery_saving: Option<PowerSaving>,
    hourly: Option<sound::HourlyPatch>,
    animations: Option<AnimationsPatch>,
    header_clock: Option<bool>,
    open_on_hover: Option<bool>,
    hover_delay: Option<u16>,
    close_delay: Option<u16>,
    module_shortcuts: Option<bool>,
    mirror_enabled: Option<bool>,
    mirror_shape: Option<MirrorShape>,
    calendar_enabled: Option<bool>,
    meeting_reminder_minutes: Option<u16>,
    week_start: Option<WeekStart>,
    timer_presets: Option<Vec<u16>>,
    timer_remember: Option<bool>,
    timer_then_break: Option<bool>,
    panel: Option<panel::Patch>,
    todo: Option<todo::Patch>,
    health: Option<health::Patch>,
    battery: Option<battery::Patch>,
    bluetooth: Option<bluetooth::Patch>,
    live: Option<LiveActivitiesPatch>,
    shelf: Option<shelf::PreferencesPatch>,
    bedtime_reminder: Option<bool>,
    bedtime_chime_dnd: Option<bool>,
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
        self.meeting_reminder_minutes = self.meeting_reminder_minutes.min(30);
        self.timer_presets
            .retain(|minutes| (1..=600).contains(minutes));
        self.timer_presets.sort_unstable();
        self.timer_presets.dedup();
        self.timer_presets.truncate(8);
        normalize_list(&mut self.module_order);
        normalize_list(&mut self.hidden_modules);
        for id in MODULES {
            if !self.module_order.iter().any(|entry| entry == id) {
                self.module_order.push((*id).into());
            }
        }
        if !MODULES.iter().any(|id| self.visible(id)) {
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

    pub(super) fn visible(&self, id: &str) -> bool {
        known(id)
            && (id != "shelf" || self.shelf.enabled)
            && self.hidden_modules.iter().all(|hidden| hidden != id)
    }

    fn apply(&mut self, patch: SettingsPatch) -> Result<(), String> {
        if let Some(name) = patch.user_name {
            let name = clean_name(&name);
            self.user_name = name;
        }
        if let Some(display) = patch.closed_display {
            self.closed_display.apply(display);
        }
        if patch.hover_delay.is_some_and(|ms| ms > 800)
            || patch.close_delay.is_some_and(|ms| ms > 1500)
        {
            return Err("Choose a delay within the displayed range".into());
        }
        if patch
            .meeting_reminder_minutes
            .is_some_and(|minutes| minutes > 30)
        {
            return Err("Choose a meeting reminder between 0 and 30 minutes".into());
        }
        if let Some(presets) = patch.timer_presets {
            if presets.len() > 8 || presets.iter().any(|minutes| !(1..=600).contains(minutes)) {
                return Err("Choose up to eight timer presets from 1 to 600 minutes".into());
            }
            self.timer_presets = presets;
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
        if let Some(panel) = patch.panel {
            self.panel.apply(panel)?;
        }
        if let Some(todo) = patch.todo {
            self.todo.apply(todo)?;
        }
        if let Some(health) = patch.health {
            self.health.apply(health)?;
        }
        if let Some(battery) = patch.battery {
            self.battery.apply(battery)?;
        }
        if let Some(bluetooth) = patch.bluetooth {
            self.bluetooth.apply(bluetooth)?;
        }
        if let Some(live) = patch.live {
            self.live.apply(live)?;
        }
        if let Some(shelf) = patch.shelf {
            self.shelf.apply(shelf)?;
        }
        self.clock_format = patch.clock_format.unwrap_or(self.clock_format);
        self.clock_with_activities = patch
            .clock_with_activities
            .unwrap_or(self.clock_with_activities);
        self.media_enabled = patch.media_enabled.unwrap_or(self.media_enabled);
        self.music_progress = patch.music_progress.unwrap_or(self.music_progress);
        self.color_glow = patch.color_glow.unwrap_or(self.color_glow);
        self.haptics = patch.haptics.unwrap_or(self.haptics);
        self.battery_saving = patch.battery_saving.unwrap_or(self.battery_saving);
        if let Some(hourly) = patch.hourly {
            self.hourly.apply(hourly)?;
        }
        if let Some(animations) = patch.animations {
            self.animations.apply(animations);
        }
        self.header_clock = patch.header_clock.unwrap_or(self.header_clock);
        self.open_on_hover = patch.open_on_hover.unwrap_or(self.open_on_hover);
        self.hover_delay = patch.hover_delay.unwrap_or(self.hover_delay);
        self.close_delay = patch.close_delay.unwrap_or(self.close_delay);
        self.module_shortcuts = patch.module_shortcuts.unwrap_or(self.module_shortcuts);
        self.mirror_enabled = patch.mirror_enabled.unwrap_or(self.mirror_enabled);
        self.mirror_shape = patch.mirror_shape.unwrap_or(self.mirror_shape);
        self.calendar_enabled = patch.calendar_enabled.unwrap_or(self.calendar_enabled);
        self.meeting_reminder_minutes = patch
            .meeting_reminder_minutes
            .unwrap_or(self.meeting_reminder_minutes);
        self.week_start = patch.week_start.unwrap_or(self.week_start);
        self.timer_remember = patch.timer_remember.unwrap_or(self.timer_remember);
        self.timer_then_break = patch.timer_then_break.unwrap_or(self.timer_then_break);
        self.bedtime_reminder = patch.bedtime_reminder.unwrap_or(self.bedtime_reminder);
        self.bedtime_chime_dnd = patch.bedtime_chime_dnd.unwrap_or(self.bedtime_chime_dnd);
        self.remember_module = patch.remember_module.unwrap_or(self.remember_module);
        self.normalize();
        Ok(())
    }
}

#[tauri::command]
pub(super) fn claim_poni_greeting(
    window: tauri::WebviewWindow,
    sequence: State<'_, Mutex<crate::WindowSequence>>,
    store: State<'_, Mutex<Store>>,
    name: String,
) -> Result<bool, String> {
    if window.label() != "main" || name.is_empty() {
        return Ok(false);
    }
    let state = sequence.lock().map_err(|_| "Window state unavailable")?;
    if !state.presentation.can_show_greeting() {
        return Ok(false);
    }
    let mut store = store.lock().map_err(|_| "Storage unavailable")?;
    let today = chrono::Local::now().date_naive();
    if store.data.settings.user_name != name || store.data.last_greeting == Some(today) {
        return Ok(false);
    }
    store.update(|data| {
        data.last_greeting = Some(today);
        Ok(())
    })?;
    Ok(true)
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
    app: AppHandle,
    store: State<'_, Mutex<Store>>,
    patch: SettingsPatch,
) -> Result<PoniSettings, String> {
    let result = store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| data.settings.apply(patch))?
        .settings;
    publish(&app, &result);
    crate::clipboard::reconcile(&app);
    Ok(result)
}

pub(super) fn publish(app: &AppHandle, settings: &PoniSettings) {
    #[cfg(windows)]
    if let Some(tray) = tauri::Manager::try_state::<crate::NotchTray>(app) {
        let _ = tray.0.set_checked(settings.panel.enabled);
    }
    crate::sync_panel(app);
    let _ = app.emit("poni-settings-changed", settings);
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
    fn older_profiles_accept_independent_closed_display_and_bluetooth_changes() {
        let mut settings: PoniSettings = serde_json::from_str("{}").unwrap();
        assert!(settings.user_name.is_empty());
        settings
            .apply(
                serde_json::from_str(
                    r#"{"user_name":"  Ayu\tPratiwi  ","closed_display":{"left":"world","mode":"date"},"bluetooth":{"low_threshold":35},"live":{"bluetooth":false}}"#,
                )
                .unwrap(),
            )
            .unwrap();
        settings
            .apply(
                serde_json::from_str(r#"{"closed_display":{"bold":true,"size":"xlarge"}}"#)
                    .unwrap(),
            )
            .unwrap();
        let saved = serde_json::to_value(&settings).unwrap();
        assert_eq!(saved["user_name"], "Ayu Pratiwi");
        assert_eq!(saved["closed_display"]["left"], "world");
        assert_eq!(saved["closed_display"]["mode"], "date");
        assert_eq!(saved["closed_display"]["right"], "battery");
        assert_eq!(saved["closed_display"]["bold"], true);
        assert_eq!(saved["bluetooth"]["low_threshold"], 35);
        assert_eq!(saved["live"]["bluetooth"], false);
        assert!(settings
            .apply(serde_json::from_str(r#"{"bluetooth":{"low_threshold":37}}"#).unwrap())
            .is_err());
    }

    #[test]
    fn timer_presets_sort_deduplicate_and_validate() {
        let mut settings = PoniSettings::default();
        let patch = serde_json::from_str(
            r#"{"timer_presets":[45,10,45],"timer_remember":false,"timer_then_break":true}"#,
        )
        .unwrap();
        settings.apply(patch).unwrap();
        assert_eq!(settings.timer_presets, [10, 45]);
        assert!(!settings.timer_remember && settings.timer_then_break);
        assert!(settings
            .apply(SettingsPatch {
                timer_presets: Some(vec![601]),
                ..SettingsPatch::default()
            })
            .is_err());
        assert_eq!(settings.timer_presets, [10, 45]);
    }

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

    #[test]
    fn calendar_defaults_migrate_and_accept_the_original_reminder_range() {
        let mut settings: PoniSettings = serde_json::from_str("{}").unwrap();
        assert!(settings.calendar_enabled);
        assert_eq!(settings.meeting_reminder_minutes, 5);
        assert_eq!(settings.week_start, WeekStart::Windows);

        let patch = serde_json::from_str(
            r#"{"calendar_enabled":false,"meeting_reminder_minutes":0,"week_start":"sunday"}"#,
        )
        .unwrap();
        settings.apply(patch).unwrap();
        assert!(!settings.calendar_enabled);
        assert_eq!(settings.meeting_reminder_minutes, 0);
        assert_eq!(settings.week_start, WeekStart::Sunday);
        let saved = serde_json::to_value(&settings).unwrap();
        assert_eq!(saved["week_start"], "sunday");

        settings
            .apply(SettingsPatch {
                meeting_reminder_minutes: Some(30),
                ..SettingsPatch::default()
            })
            .unwrap();
        let invalid = SettingsPatch {
            meeting_reminder_minutes: Some(31),
            ..SettingsPatch::default()
        };
        assert!(settings.apply(invalid).is_err());
        assert_eq!(settings.meeting_reminder_minutes, 30);
    }
}
