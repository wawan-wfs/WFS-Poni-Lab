use serde::{Deserialize, Serialize};
use std::time::{Duration, SystemTime};
use tauri::{Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

#[derive(Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum LayoutDirection {
    #[default]
    Auto,
    Ltr,
    Rtl,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(default)]
pub(super) struct Preferences {
    direction: LayoutDirection,
    top_gap: u16,
    pub(super) position: u16,
    width: u16,
    height: u16,
    expanded_width: u16,
    expanded_height: u16,
    tall_height: u16,
    opacity: u16,
    pub(super) show_in_screenshots: bool,
    warm_night: bool,
    warmth: u16,
    pub(super) enabled: bool,
    display: String,
    pub(super) lock_position: bool,
    hide_in_fullscreen: bool,
    auto_hide: bool,
    standby_show: bool,
    standby_secs: u16,
    hide_button: bool,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            direction: LayoutDirection::Auto,
            top_gap: 0,
            position: 50,
            width: 200,
            height: 32,
            expanded_width: 680,
            expanded_height: 196,
            tall_height: 268,
            opacity: 100,
            show_in_screenshots: true,
            warm_night: false,
            warmth: 60,
            enabled: true,
            display: "primary".into(),
            lock_position: false,
            hide_in_fullscreen: true,
            auto_hide: false,
            standby_show: false,
            standby_secs: 12,
            hide_button: false,
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Patch {
    direction: Option<LayoutDirection>,
    top_gap: Option<u16>,
    position: Option<u16>,
    width: Option<u16>,
    height: Option<u16>,
    expanded_width: Option<u16>,
    expanded_height: Option<u16>,
    tall_height: Option<u16>,
    opacity: Option<u16>,
    show_in_screenshots: Option<bool>,
    warm_night: Option<bool>,
    warmth: Option<u16>,
    enabled: Option<bool>,
    display: Option<String>,
    lock_position: Option<bool>,
    hide_in_fullscreen: Option<bool>,
    auto_hide: Option<bool>,
    standby_show: Option<bool>,
    standby_secs: Option<u16>,
    hide_button: Option<bool>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Layer {
    Hidden,
    Handle(u16),
    Normal,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct Geometry {
    size: PhysicalSize<u32>,
    position: PhysicalPosition<i32>,
}

#[derive(Default)]
pub(super) struct Presentation {
    pub(super) open: bool,
    pub(super) tall: bool,
    pub(super) alert: bool,
    pub(super) tucked: bool,
    pub(super) forced: bool,
    pub(super) visible: Option<bool>,
    pub(super) move_preview: Option<u16>,
    pub(super) snooze_until: Option<SystemTime>,
    geometry: Option<Geometry>,
    edge_revealed: bool,
}

impl Presentation {
    pub(super) fn snoozed(&self) -> bool {
        self.snooze_until
            .is_some_and(|until| until > SystemTime::now())
    }

    pub(super) fn toggle_snooze(&mut self, minutes: u16) -> bool {
        let snoozed = !self.snoozed();
        self.snooze_until =
            snoozed.then(|| SystemTime::now() + Duration::from_secs(u64::from(minutes) * 60));
        if snoozed {
            self.open = false;
            self.tall = false;
            self.forced = false;
            self.move_preview = None;
        }
        snoozed
    }
}

#[derive(Serialize)]
pub(super) struct DisplayOption {
    id: String,
    label: String,
}

#[tauri::command]
pub(super) fn panel_displays(window: WebviewWindow) -> Result<Vec<DisplayOption>, String> {
    let monitors = window
        .available_monitors()
        .map_err(|error| error.to_string())?;
    Ok(monitors
        .iter()
        .enumerate()
        .filter_map(|(index, monitor)| {
            let name = monitor.name()?;
            let size = monitor.size();
            Some(DisplayOption {
                id: format!("monitor:{name}"),
                label: format!("Display {} · {} × {}", index + 1, size.width, size.height),
            })
        })
        .collect())
}

impl Preferences {
    pub(super) fn apply(&mut self, patch: Patch) -> Result<(), String> {
        for (name, value, minimum, maximum, step) in [
            ("top gap", patch.top_gap, 0, 120, 2),
            ("position", patch.position, 0, 100, 1),
            ("closed width", patch.width, 80, 320, 2),
            ("closed height", patch.height, 22, 44, 1),
            ("expanded width", patch.expanded_width, 560, 780, 10),
            ("expanded height", patch.expanded_height, 170, 260, 2),
            ("tall height", patch.tall_height, 220, 340, 2),
            ("opacity", patch.opacity, 20, 100, 5),
            ("night warmth", patch.warmth, 10, 100, 5),
            ("standby time", patch.standby_secs, 1, 3600, 1),
        ] {
            if value.is_some_and(|value| {
                !(minimum..=maximum).contains(&value) || (value - minimum) % step != 0
            }) {
                return Err(format!("Choose a valid {name} within the displayed range"));
            }
        }
        if patch.display.as_ref().is_some_and(|display| {
            !matches!(display.as_str(), "primary" | "cursor")
                && !display.strip_prefix("monitor:").is_some_and(|name| {
                    !name.is_empty() && name.len() <= 128 && !name.chars().any(char::is_control)
                })
        }) {
            return Err("Choose a valid display".into());
        }
        self.direction = patch.direction.unwrap_or(self.direction);
        self.top_gap = patch.top_gap.unwrap_or(self.top_gap);
        self.position = patch.position.unwrap_or(self.position);
        self.width = patch.width.unwrap_or(self.width);
        self.height = patch.height.unwrap_or(self.height);
        self.expanded_width = patch.expanded_width.unwrap_or(self.expanded_width);
        self.expanded_height = patch.expanded_height.unwrap_or(self.expanded_height);
        self.tall_height = patch.tall_height.unwrap_or(self.tall_height);
        self.opacity = patch.opacity.unwrap_or(self.opacity);
        self.show_in_screenshots = patch
            .show_in_screenshots
            .unwrap_or(self.show_in_screenshots);
        self.warm_night = patch.warm_night.unwrap_or(self.warm_night);
        self.warmth = patch.warmth.unwrap_or(self.warmth);
        self.enabled = patch.enabled.unwrap_or(self.enabled);
        if let Some(display) = patch.display {
            self.display = display;
        }
        self.lock_position = patch.lock_position.unwrap_or(self.lock_position);
        self.hide_in_fullscreen = patch.hide_in_fullscreen.unwrap_or(self.hide_in_fullscreen);
        self.auto_hide = patch.auto_hide.unwrap_or(self.auto_hide);
        self.standby_show = patch.standby_show.unwrap_or(self.standby_show);
        self.standby_secs = patch.standby_secs.unwrap_or(self.standby_secs);
        self.hide_button = patch.hide_button.unwrap_or(self.hide_button);
        Ok(())
    }

    fn dimensions(&self, open: bool, tall: bool) -> (u16, u16) {
        match (open, tall) {
            (true, true) => (self.expanded_width, self.tall_height),
            (true, false) => (self.expanded_width, self.expanded_height),
            (false, _) => (self.width, self.height),
        }
    }

    fn fit(
        &self,
        dimensions: (u16, u16),
        work_size: PhysicalSize<u32>,
        scale: f64,
    ) -> (PhysicalSize<u32>, u32) {
        let pixels = |logical: u16| (f64::from(logical) * scale).round() as u32;
        let gap = pixels(self.top_gap).min(work_size.height.saturating_sub(1));
        let width = pixels(dimensions.0).min(work_size.width).max(1);
        let height = pixels(dimensions.1)
            .min(work_size.height.saturating_sub(gap))
            .max(1);
        (PhysicalSize::new(width, height), gap)
    }

    fn horizontal_offset(&self, display_width: u32, panel_width: u32) -> i32 {
        Self::offset_for(self.position, display_width, panel_width)
    }

    fn offset_for(position: u16, display_width: u32, panel_width: u32) -> i32 {
        let travel = u64::from(display_width.saturating_sub(panel_width));
        ((travel * u64::from(position.min(100)) + 50) / 100) as i32
    }

    pub(super) fn position_after_drag(
        &self,
        window: &WebviewWindow,
        delta: i32,
    ) -> Result<u16, String> {
        let monitor = window
            .current_monitor()
            .map_err(|error| error.to_string())?
            .ok_or("The notch display is unavailable")?;
        let width = window
            .inner_size()
            .map_err(|error| error.to_string())?
            .width;
        let travel = f64::from(monitor.size().width.saturating_sub(width));
        Ok(self.drag_position(travel, f64::from(delta), monitor.scale_factor()))
    }

    fn drag_position(&self, travel: f64, delta: f64, scale: f64) -> u16 {
        if travel <= 0.0 {
            return self.position;
        }
        let target = (travel * f64::from(self.position) / 100.0 + delta * scale).clamp(0.0, travel);
        if (target - travel / 2.0).abs() <= 10.0 * scale {
            50
        } else {
            (target * 100.0 / travel).round() as u16
        }
    }

    fn monitor(
        &self,
        window: &WebviewWindow,
        open: bool,
        cursor: Option<PhysicalPosition<f64>>,
    ) -> Option<Monitor> {
        let chosen = if self.display == "cursor" {
            if open {
                window.current_monitor().ok().flatten()
            } else {
                cursor.and_then(|point| window.monitor_from_point(point.x, point.y).ok().flatten())
            }
        } else {
            self.display.strip_prefix("monitor:").and_then(|name| {
                window
                    .available_monitors()
                    .ok()?
                    .into_iter()
                    .find(|monitor| monitor.name().is_some_and(|value| value == name))
            })
        };
        chosen
            .or_else(|| window.primary_monitor().ok().flatten())
            .or_else(|| window.current_monitor().ok().flatten())
    }

    fn layer(&self, state: &Presentation, fullscreen: bool, idle_ms: Option<u32>) -> Layer {
        if !self.enabled
            || state.snoozed()
            || (self.hide_in_fullscreen && fullscreen && !state.forced)
        {
            return Layer::Hidden;
        }
        if state.open || state.alert {
            return Layer::Normal;
        }
        if state.tucked {
            return Layer::Handle(10);
        }
        let standby = self.standby_show
            && idle_ms.is_some_and(|ms| ms >= u32::from(self.standby_secs) * 1000);
        if self.auto_hide && !state.edge_revealed && !standby {
            return Layer::Handle(4);
        }
        Layer::Normal
    }

    pub(super) fn apply_layout(
        &self,
        window: &WebviewWindow,
        state: &mut Presentation,
    ) -> Result<(), String> {
        let mut dimensions = self.dimensions(state.open, state.tall);
        if !state.open && state.alert {
            dimensions.0 = dimensions.0.max(320);
            dimensions.1 += 44;
        }
        let cursor = window.cursor_position().ok();
        let monitor = self.monitor(window, state.open || state.move_preview.is_some(), cursor);
        let fullscreen =
            self.hide_in_fullscreen && monitor.as_ref().is_some_and(foreground_fullscreen);
        let idle_ms = (self.auto_hide && self.standby_show)
            .then(crate::activity::idle_millis)
            .flatten();
        let mut geometry = if let Some(monitor) = monitor {
            let (size, gap) =
                self.fit(dimensions, monitor.work_area().size, monitor.scale_factor());
            let offset = match state.move_preview {
                Some(position) if !self.lock_position => {
                    Self::offset_for(position, monitor.size().width, size.width)
                }
                _ => self.horizontal_offset(monitor.size().width, size.width),
            };
            let x = monitor.position().x.saturating_add(offset);
            let top = monitor.position().y;
            let reach = if state.edge_revealed {
                gap.saturating_add(size.height)
            } else {
                (6.0 * monitor.scale_factor()).ceil() as u32
            };
            state.edge_revealed = self.auto_hide
                && cursor.is_some_and(|cursor| {
                    cursor.x >= f64::from(x)
                        && cursor.x < f64::from(x) + f64::from(size.width)
                        && cursor.y >= f64::from(top)
                        && cursor.y <= f64::from(top) + f64::from(reach)
                });
            let mut geometry = Geometry {
                size,
                position: PhysicalPosition::new(x, top.saturating_add(gap as i32)),
            };
            if let Layer::Handle(height) = self.layer(state, fullscreen, idle_ms) {
                geometry.size.height = (f64::from(height) * monitor.scale_factor())
                    .round()
                    .max(1.0) as u32;
                geometry.position.y = top;
            }
            Some(geometry)
        } else {
            None
        };
        let visible = self.layer(state, fullscreen, idle_ms) != Layer::Hidden;
        if !visible {
            geometry = None;
        }
        if let Some(geometry) = geometry.filter(|geometry| Some(*geometry) != state.geometry) {
            window
                .set_size(geometry.size)
                .map_err(|error| error.to_string())?;
            position_client(window, geometry.position).map_err(|error| error.to_string())?;
            state.geometry = Some(geometry);
        }
        if state.visible != Some(visible) {
            if visible {
                window.show()
            } else {
                window.hide()
            }
            .map_err(|error| error.to_string())?;
            state.visible = Some(visible);
        }
        Ok(())
    }
}

#[cfg(windows)]
fn foreground_fullscreen(monitor: &Monitor) -> bool {
    use windows_sys::Win32::{
        Foundation::RECT,
        UI::WindowsAndMessaging::{
            GetDesktopWindow, GetForegroundWindow, GetShellWindow, GetWindowLongW, GetWindowRect,
            GetWindowThreadProcessId, IsIconic, IsWindowVisible, IsZoomed, GWL_STYLE, WS_CAPTION,
        },
    };
    let position = monitor.position();
    let size = monitor.size();
    unsafe {
        let front = GetForegroundWindow();
        if front.is_null()
            || front == GetDesktopWindow()
            || front == GetShellWindow()
            || IsIconic(front) != 0
            || IsWindowVisible(front) == 0
        {
            return false;
        }
        let mut pid = 0;
        GetWindowThreadProcessId(front, &mut pid);
        if pid == std::process::id()
            || (IsZoomed(front) != 0
                && GetWindowLongW(front, GWL_STYLE) as u32 & WS_CAPTION == WS_CAPTION)
        {
            return false;
        }
        let mut rect = RECT::default();
        GetWindowRect(front, &mut rect) != 0
            && rect.left <= position.x.saturating_add(2)
            && rect.top <= position.y.saturating_add(2)
            && rect.right
                >= position
                    .x
                    .saturating_add(size.width as i32)
                    .saturating_sub(2)
            && rect.bottom
                >= position
                    .y
                    .saturating_add(size.height as i32)
                    .saturating_sub(2)
    }
}

#[cfg(not(windows))]
fn foreground_fullscreen(_monitor: &Monitor) -> bool {
    false
}

pub(super) fn position_client(
    window: &WebviewWindow,
    position: PhysicalPosition<i32>,
) -> tauri::Result<()> {
    let outer = window.outer_position()?;
    let inner = window.inner_position()?;
    window.set_position(PhysicalPosition::new(
        position.x.saturating_sub(inner.x.saturating_sub(outer.x)),
        position.y.saturating_sub(inner.y.saturating_sub(outer.y)),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_and_position_follow_scale_and_fit_the_display() {
        let mut preferences = Preferences::default();
        let patch = serde_json::from_str(
            r#"{"width":250,"height":40,"top_gap":24,"position":94,"expanded_height":230,"tall_height":330,"opacity":45}"#,
        )
        .unwrap();
        preferences.apply(patch).unwrap();
        assert_eq!(preferences.dimensions(false, false), (250, 40));
        assert_eq!(preferences.dimensions(true, false).1, 230);
        assert_eq!(preferences.dimensions(true, true).1, 330);
        let (size, gap) = preferences.fit((250, 40), PhysicalSize::new(800, 82), 1.5);
        assert_eq!(size, PhysicalSize::new(375, 46));
        assert_eq!(gap, 36);
        assert_eq!(preferences.horizontal_offset(800, 375), 400);
        assert_eq!(preferences.horizontal_offset(300, 375), 0);
    }

    #[test]
    fn invalid_size_patch_leaves_other_fields_unchanged() {
        let mut preferences = Preferences::default();
        let previous_width = preferences.width;
        let patch = serde_json::from_str(r#"{"width":250,"top_gap":3}"#).unwrap();
        assert!(preferences.apply(patch).is_err());
        assert_eq!(preferences.width, previous_width);
    }

    #[test]
    fn auto_hide_standby_and_fullscreen_preserve_alerts_and_manual_opening() {
        let mut preferences = Preferences::default();
        preferences
            .apply(
                serde_json::from_str(r#"{"auto_hide":true,"standby_show":true,"standby_secs":4}"#)
                    .unwrap(),
            )
            .unwrap();
        let mut state = Presentation::default();
        assert_eq!(
            preferences.layer(&state, false, Some(3_999)),
            Layer::Handle(4)
        );
        assert_eq!(preferences.layer(&state, false, Some(4_000)), Layer::Normal);
        state.tucked = true;
        assert_eq!(
            preferences.layer(&state, false, Some(8_000)),
            Layer::Handle(10)
        );
        state.alert = true;
        assert_eq!(preferences.layer(&state, false, Some(0)), Layer::Normal);
        assert_eq!(preferences.layer(&state, true, Some(0)), Layer::Hidden);
        state.open = true;
        state.forced = true;
        assert_eq!(preferences.layer(&state, true, Some(0)), Layer::Normal);
        preferences.enabled = false;
        assert_eq!(preferences.layer(&state, true, Some(0)), Layer::Hidden);
    }

    #[test]
    fn moving_the_notch_clamps_and_snaps_in_scaled_coordinates() {
        let preferences = Preferences::default();
        assert_eq!(preferences.drag_position(700.0, 9.0, 1.5), 50);
        assert_eq!(preferences.drag_position(700.0, 70.0, 2.0), 70);
        assert_eq!(preferences.drag_position(700.0, -400.0, 1.0), 0);
        assert_eq!(preferences.drag_position(700.0, 400.0, 1.0), 100);
    }

    #[test]
    fn snooze_hides_the_notch_until_woken_or_expired() {
        let preferences = Preferences::default();
        let mut state = Presentation {
            open: true,
            forced: true,
            ..Presentation::default()
        };
        assert!(state.toggle_snooze(30));
        assert!(!state.open);
        assert_eq!(preferences.layer(&state, false, Some(0)), Layer::Hidden);
        assert!(!state.toggle_snooze(30));
        assert_eq!(preferences.layer(&state, false, Some(0)), Layer::Normal);
        state.snooze_until = Some(SystemTime::UNIX_EPOCH);
        assert_eq!(preferences.layer(&state, false, Some(0)), Layer::Normal);
    }
}
