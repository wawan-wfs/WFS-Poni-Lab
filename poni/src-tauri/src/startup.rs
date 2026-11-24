#[cfg(windows)]
mod platform {
    use std::{ffi::OsStr, io, os::windows::ffi::OsStrExt, ptr};
    use windows_sys::Win32::{
        Foundation::{ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND, ERROR_SUCCESS},
        System::Registry::{
            RegDeleteKeyValueW, RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ,
            RRF_RT_REG_SZ,
        },
    };

    const KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const ENTRY: &str = "Poni Rebuild";

    fn wide(value: impl AsRef<OsStr>) -> Vec<u16> {
        value.as_ref().encode_wide().chain([0]).collect()
    }

    pub(super) fn enabled() -> Result<bool, String> {
        let key = wide(KEY);
        let entry = wide(ENTRY);
        let mut size = 0;
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                key.as_ptr(),
                entry.as_ptr(),
                RRF_RT_REG_SZ,
                ptr::null_mut(),
                ptr::null_mut(),
                &mut size,
            )
        };
        match status {
            ERROR_SUCCESS => Ok(size > 2),
            ERROR_FILE_NOT_FOUND | ERROR_PATH_NOT_FOUND => Ok(false),
            error => Err(io::Error::from_raw_os_error(error as i32).to_string()),
        }
    }

    pub(super) fn set_enabled(enabled: bool) -> Result<(), String> {
        let key = wide(KEY);
        let entry = wide(ENTRY);
        let status = if enabled {
            let exe = std::env::current_exe().map_err(|error| error.to_string())?;
            let mut command = std::ffi::OsString::from("\"");
            command.push(exe.as_os_str());
            command.push("\"");
            let value = wide(command);
            unsafe {
                RegSetKeyValueW(
                    HKEY_CURRENT_USER,
                    key.as_ptr(),
                    entry.as_ptr(),
                    REG_SZ,
                    value.as_ptr().cast(),
                    (value.len() * std::mem::size_of::<u16>()) as u32,
                )
            }
        } else {
            unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), entry.as_ptr()) }
        };
        match status {
            ERROR_SUCCESS => Ok(()),
            ERROR_FILE_NOT_FOUND | ERROR_PATH_NOT_FOUND if !enabled => Ok(()),
            error => Err(io::Error::from_raw_os_error(error as i32).to_string()),
        }
    }
}

#[tauri::command]
pub(super) fn get_poni_startup() -> Result<Option<bool>, String> {
    #[cfg(windows)]
    return platform::enabled().map(Some);
    #[cfg(not(windows))]
    Ok(None)
}

#[tauri::command]
pub(super) fn set_poni_startup(enabled: bool) -> Result<bool, String> {
    #[cfg(windows)]
    {
        platform::set_enabled(enabled)?;
        platform::enabled()
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Err("Launch at login is available on Windows".into())
    }
}
