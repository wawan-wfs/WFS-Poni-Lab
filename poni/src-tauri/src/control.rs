use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

#[derive(Default)]
pub(super) struct ControlState {
    #[cfg(windows)]
    keep_awake: Option<std::os::windows::io::OwnedHandle>,
}

#[derive(Serialize)]
pub(super) struct ControlSnapshot {
    available: bool,
    keep_awake: bool,
    volume: Option<Volume>,
    microphone_muted: Option<bool>,
}

#[derive(Serialize)]
struct Volume {
    level: u8,
    muted: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum AudioDevice {
    Output,
    Microphone,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum SettingsPage {
    Wifi,
    Bluetooth,
    Display,
    Sound,
    NightLight,
    Personalization,
}

#[tauri::command]
pub(super) fn control_snapshot(
    state: State<'_, Mutex<ControlState>>,
) -> Result<ControlSnapshot, String> {
    #[cfg(windows)]
    {
        let keep_awake = state
            .lock()
            .map_err(|_| "Control unavailable")?
            .keep_awake
            .is_some();
        Ok(ControlSnapshot {
            available: true,
            keep_awake,
            volume: native::volume().ok(),
            microphone_muted: native::mute(AudioDevice::Microphone, None).ok(),
        })
    }
    #[cfg(not(windows))]
    {
        let _ = state;
        Ok(ControlSnapshot {
            available: false,
            keep_awake: false,
            volume: None,
            microphone_muted: None,
        })
    }
}

#[tauri::command]
pub(super) fn set_keep_awake(
    state: State<'_, Mutex<ControlState>>,
    enabled: bool,
) -> Result<bool, String> {
    #[cfg(windows)]
    {
        let mut control = state.lock().map_err(|_| "Control unavailable")?;
        if enabled {
            if control.keep_awake.is_none() {
                control.keep_awake = Some(native::create_keep_awake()?);
            }
        } else if let Some(request) = control.keep_awake.as_ref() {
            native::clear_keep_awake(request)?;
            control.keep_awake = None;
        }
        Ok(control.keep_awake.is_some())
    }
    #[cfg(not(windows))]
    {
        let _ = (state, enabled);
        Err("Keep awake is available on Windows".into())
    }
}

#[tauri::command]
pub(super) fn set_control_volume(level: u8) -> Result<u8, String> {
    if level > 100 {
        return Err("Choose a volume from 0 to 100".into());
    }
    #[cfg(windows)]
    {
        native::set_volume(level)
    }
    #[cfg(not(windows))]
    {
        Err("Volume control is available on Windows".into())
    }
}

#[tauri::command]
pub(super) fn set_control_mute(device: AudioDevice, muted: bool) -> Result<bool, String> {
    #[cfg(windows)]
    {
        native::mute(device, Some(muted))
    }
    #[cfg(not(windows))]
    {
        let _ = (device, muted);
        Err("Mute control is available on Windows".into())
    }
}

#[tauri::command]
pub(super) fn open_control_settings(page: SettingsPage) -> Result<(), String> {
    #[cfg(windows)]
    {
        native::open_settings(page)
    }
    #[cfg(not(windows))]
    {
        let _ = page;
        Err("Windows Settings are unavailable here".into())
    }
}

#[cfg(windows)]
mod native {
    use super::{AudioDevice, SettingsPage, Volume};
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use std::ptr;
    use windows::core::Result as WindowsResult;
    use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
    use windows::Win32::Media::Audio::{
        eCapture, eConsole, eRender, Endpoints::IAudioEndpointVolume, IMMDeviceEnumerator,
        MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_MULTITHREADED,
    };
    use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
    use windows_sys::Win32::System::Power::{
        PowerClearRequest, PowerCreateRequest, PowerRequestSystemRequired, PowerSetRequest,
    };
    use windows_sys::Win32::System::Threading::{
        POWER_REQUEST_CONTEXT_SIMPLE_STRING, REASON_CONTEXT, REASON_CONTEXT_0,
    };
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};

    pub(super) fn create_keep_awake() -> Result<OwnedHandle, String> {
        let mut reason: Vec<u16> = "Poni: Keep awake".encode_utf16().chain([0]).collect();
        let context = REASON_CONTEXT {
            Version: 0,
            Flags: POWER_REQUEST_CONTEXT_SIMPLE_STRING,
            Reason: REASON_CONTEXT_0 {
                SimpleReasonString: reason.as_mut_ptr(),
            },
        };
        let handle = unsafe { PowerCreateRequest(&context) };
        if handle == INVALID_HANDLE_VALUE || handle.is_null() {
            return Err(format!(
                "Could not request keep awake: {}",
                std::io::Error::last_os_error()
            ));
        }
        let request = unsafe { OwnedHandle::from_raw_handle(handle) };
        if unsafe { PowerSetRequest(request.as_raw_handle(), PowerRequestSystemRequired) } == 0 {
            return Err(format!(
                "Could not keep this PC awake: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(request)
    }

    pub(super) fn clear_keep_awake(request: &OwnedHandle) -> Result<(), String> {
        if unsafe { PowerClearRequest(request.as_raw_handle(), PowerRequestSystemRequired) } == 0 {
            return Err(format!(
                "Could not clear keep awake: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(())
    }

    struct ComGuard(bool);

    impl ComGuard {
        fn initialize() -> WindowsResult<Self> {
            let result = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
            // An existing STA is also suitable, but it belongs to the caller.
            if result == RPC_E_CHANGED_MODE {
                return Ok(Self(false));
            }
            result.ok()?;
            Ok(Self(true))
        }
    }

    impl Drop for ComGuard {
        fn drop(&mut self) {
            if self.0 {
                unsafe { CoUninitialize() };
            }
        }
    }

    fn with_endpoint<T>(
        device: AudioDevice,
        action: impl FnOnce(&IAudioEndpointVolume) -> WindowsResult<T>,
    ) -> Result<T, String> {
        let result = (|| -> WindowsResult<T> {
            let _com = ComGuard::initialize()?;
            let flow = match device {
                AudioDevice::Output => eRender,
                AudioDevice::Microphone => eCapture,
            };
            let enumerator: IMMDeviceEnumerator =
                unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_INPROC_SERVER) }?;
            let device = unsafe { enumerator.GetDefaultAudioEndpoint(flow, eConsole) }?;
            let endpoint: IAudioEndpointVolume =
                unsafe { device.Activate(CLSCTX_INPROC_SERVER, None) }?;
            action(&endpoint)
        })();
        result.map_err(|error| format!("Audio device unavailable: {error}"))
    }

    pub(super) fn volume() -> Result<Volume, String> {
        with_endpoint(AudioDevice::Output, |endpoint| unsafe {
            Ok(Volume {
                level: (endpoint.GetMasterVolumeLevelScalar()?.clamp(0.0, 1.0) * 100.0).round()
                    as u8,
                muted: endpoint.GetMute()?.as_bool(),
            })
        })
    }

    pub(super) fn set_volume(level: u8) -> Result<u8, String> {
        with_endpoint(AudioDevice::Output, |endpoint| unsafe {
            endpoint.SetMasterVolumeLevelScalar(f32::from(level) / 100.0, ptr::null())?;
            Ok((endpoint.GetMasterVolumeLevelScalar()?.clamp(0.0, 1.0) * 100.0).round() as u8)
        })
    }

    pub(super) fn mute(device: AudioDevice, muted: Option<bool>) -> Result<bool, String> {
        with_endpoint(device, |endpoint| unsafe {
            if let Some(muted) = muted {
                endpoint.SetMute(muted, ptr::null())?;
            }
            Ok(endpoint.GetMute()?.as_bool())
        })
    }

    pub(super) fn open_settings(page: SettingsPage) -> Result<(), String> {
        let uri = match page {
            SettingsPage::Wifi => "ms-settings:network-wifi",
            SettingsPage::Bluetooth => "ms-settings:bluetooth",
            SettingsPage::Display => "ms-settings:display",
            SettingsPage::Sound => "ms-settings:sound",
            SettingsPage::NightLight => "ms-settings:nightlight",
            SettingsPage::Personalization => "ms-settings:colors",
        };
        let verb: Vec<u16> = "open".encode_utf16().chain([0]).collect();
        let uri: Vec<u16> = uri.encode_utf16().chain([0]).collect();
        let result = unsafe {
            ShellExecuteW(
                ptr::null_mut(),
                verb.as_ptr(),
                uri.as_ptr(),
                ptr::null(),
                ptr::null(),
                SW_SHOWNORMAL,
            )
        };
        if result as isize > 32 {
            Ok(())
        } else {
            Err("Could not open Windows Settings".into())
        }
    }
}
