#[cfg(windows)]
pub(super) fn desktop_available() -> bool {
    use windows_sys::Win32::System::StationsAndDesktops::{
        CloseDesktop, GetUserObjectInformationW, OpenInputDesktop, DESKTOP_READOBJECTS, UOI_NAME,
    };
    unsafe {
        let desktop = OpenInputDesktop(0, 0, DESKTOP_READOBJECTS);
        if desktop.is_null() {
            return false;
        }
        let mut name = [0u16; 64];
        let mut written = 0;
        let ok = GetUserObjectInformationW(
            desktop,
            UOI_NAME,
            name.as_mut_ptr().cast(),
            (name.len() * 2) as u32,
            &mut written,
        );
        CloseDesktop(desktop);
        let length = name
            .iter()
            .position(|unit| *unit == 0)
            .unwrap_or(name.len());
        ok != 0 && String::from_utf16_lossy(&name[..length]).eq_ignore_ascii_case("Default")
    }
}

#[cfg(not(windows))]
pub(super) fn desktop_available() -> bool {
    true
}

#[cfg(windows)]
pub(super) fn idle_millis() -> Option<u32> {
    use windows_sys::Win32::{
        System::SystemInformation::GetTickCount,
        UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO},
    };
    let mut input = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    unsafe {
        (GetLastInputInfo(&mut input) != 0).then(|| GetTickCount().wrapping_sub(input.dwTime))
    }
}

#[cfg(not(windows))]
pub(super) fn idle_millis() -> Option<u32> {
    None
}
