use serde::{Deserialize, Serialize};
use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

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
    position: u16,
    width: u16,
    height: u16,
    expanded_width: u16,
    expanded_height: u16,
    tall_height: u16,
    opacity: u16,
    pub(super) show_in_screenshots: bool,
    warm_night: bool,
    warmth: u16,
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
        ] {
            if value.is_some_and(|value| {
                !(minimum..=maximum).contains(&value) || (value - minimum) % step != 0
            }) {
                return Err(format!("Choose a valid {name} within the displayed range"));
            }
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
        let travel = u64::from(display_width.saturating_sub(panel_width));
        ((travel * u64::from(self.position.min(100)) + 50) / 100) as i32
    }

    pub(super) fn apply_layout(
        &self,
        window: &WebviewWindow,
        open: bool,
        tall: bool,
        task_alert: bool,
    ) -> Result<(), String> {
        let mut dimensions = self.dimensions(open, tall);
        if !open && task_alert {
            dimensions.0 = dimensions.0.max(320);
            dimensions.1 += 44;
        }
        let monitor = window
            .current_monitor()
            .map_err(|error| error.to_string())?;
        let Some(monitor) = monitor else {
            return window
                .set_size(tauri::LogicalSize::new(
                    f64::from(dimensions.0),
                    f64::from(dimensions.1),
                ))
                .map_err(|error| error.to_string());
        };
        let (size, gap) = self.fit(dimensions, monitor.work_area().size, monitor.scale_factor());
        let offset = self.horizontal_offset(monitor.size().width, size.width);
        window.set_size(size).map_err(|error| error.to_string())?;
        let position = PhysicalPosition::new(
            monitor.position().x.saturating_add(offset),
            monitor.position().y.saturating_add(gap as i32),
        );
        position_client(window, position).map_err(|error| error.to_string())
    }
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
}
