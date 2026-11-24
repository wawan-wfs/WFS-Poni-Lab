use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum Icon {
    Bar,
    Ring,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(default)]
pub(super) struct Preferences {
    enabled: bool,
    show_percentage: bool,
    icon: Icon,
    charging_activity: bool,
    low_threshold: u8,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            enabled: true,
            show_percentage: true,
            icon: Icon::Bar,
            charging_activity: true,
            low_threshold: 20,
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Patch {
    enabled: Option<bool>,
    show_percentage: Option<bool>,
    icon: Option<Icon>,
    charging_activity: Option<bool>,
    low_threshold: Option<u8>,
}

impl Preferences {
    pub(super) fn apply(&mut self, patch: Patch) -> Result<(), String> {
        let threshold = patch.low_threshold.unwrap_or(self.low_threshold);
        if !(5..=50).contains(&threshold) {
            return Err("Choose a low battery warning from 5 to 50 percent".into());
        }
        self.enabled = patch.enabled.unwrap_or(self.enabled);
        self.show_percentage = patch.show_percentage.unwrap_or(self.show_percentage);
        self.icon = patch.icon.unwrap_or(self.icon);
        self.charging_activity = patch.charging_activity.unwrap_or(self.charging_activity);
        self.low_threshold = threshold;
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub(super) struct Battery {
    percent: Option<u8>,
    plugged_in: Option<bool>,
    charging: bool,
    saver: bool,
    seconds_remaining: Option<u32>,
}

#[cfg(any(windows, test))]
fn decode(ac: u8, flags: u8, percent: u8, saver: u8, seconds: u32) -> Option<Battery> {
    if flags != u8::MAX && flags & 128 != 0 {
        return None;
    }
    if flags == u8::MAX && percent == u8::MAX {
        return None;
    }
    Some(Battery {
        percent: (percent <= 100).then_some(percent),
        plugged_in: match ac {
            0 => Some(false),
            1 => Some(true),
            _ => None,
        },
        charging: flags != u8::MAX && flags & 8 != 0,
        saver: saver == 1,
        seconds_remaining: (seconds != u32::MAX).then_some(seconds),
    })
}

#[tauri::command]
pub(super) fn get_battery() -> Option<Battery> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
        let mut status: SYSTEM_POWER_STATUS = unsafe { std::mem::zeroed() };
        if unsafe { GetSystemPowerStatus(&mut status) } == 0 {
            return None;
        }
        decode(
            status.ACLineStatus,
            status.BatteryFlag,
            status.BatteryLifePercent,
            status.SystemStatusFlag,
            status.BatteryLifeTime,
        )
    }
    #[cfg(not(windows))]
    None
}

pub(super) fn monitor(app: AppHandle) {
    let mut last = get_battery();
    loop {
        std::thread::sleep(std::time::Duration::from_secs(2));
        let current = get_battery();
        if current != last {
            let _ = app.emit("poni-battery-changed", current);
            last = current;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_unknown_values_without_treating_a_desktop_as_a_battery() {
        assert_eq!(decode(1, 128, 255, 0, u32::MAX), None);
        assert_eq!(decode(1, 255, 255, 0, u32::MAX), None);
        let battery = decode(255, 8, 67, 1, u32::MAX).unwrap();
        assert_eq!(battery.percent, Some(67));
        assert_eq!(battery.plugged_in, None);
        assert!(battery.charging);
        assert!(battery.saver);
        assert_eq!(battery.seconds_remaining, None);
    }
}
