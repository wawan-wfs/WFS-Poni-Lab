use super::drop_actions::Outcome;
use std::path::{Path, PathBuf};
use tauri::WebviewWindow;

pub(super) fn owner(window: &WebviewWindow) -> Result<usize, String> {
    #[cfg(windows)]
    return window
        .hwnd()
        .map(|hwnd| hwnd.0 as usize)
        .map_err(|error| error.to_string());
    #[cfg(not(windows))]
    {
        let _ = window;
        Ok(0)
    }
}

#[cfg(windows)]
fn shell_thread(
    operation: impl FnOnce() -> Result<Outcome, String> + Send,
) -> Result<Outcome, String> {
    std::thread::scope(|scope| {
        scope
            .spawn(operation)
            .join()
            .map_err(|_| "Windows Shell stopped".to_string())?
    })
}

#[cfg(windows)]
pub(super) fn move_items(
    owner: usize,
    paths: &[PathBuf],
    folder: &Path,
) -> Result<Outcome, String> {
    shell_thread(|| native::move_items(owner, paths, folder))
}

#[cfg(windows)]
pub(super) fn open_with(owner: usize, paths: &[PathBuf]) -> Result<Outcome, String> {
    shell_thread(|| native::open_with(owner, paths))
}

#[cfg(windows)]
pub(super) fn recycle(owner: usize, paths: &[PathBuf]) -> Result<Outcome, String> {
    shell_thread(|| native::recycle(owner, paths))
}

#[cfg(windows)]
pub(super) fn eject(owner: usize, paths: &[PathBuf]) -> Result<Outcome, String> {
    shell_thread(|| native::eject(owner, paths))
}

#[cfg(not(windows))]
pub(super) fn move_items(
    _owner: usize,
    _paths: &[PathBuf],
    _folder: &Path,
) -> Result<Outcome, String> {
    Err("Moving items from the Shelf is available on Windows".into())
}

#[cfg(not(windows))]
pub(super) fn open_with(_owner: usize, _paths: &[PathBuf]) -> Result<Outcome, String> {
    Err("Open with is available on Windows".into())
}

#[cfg(not(windows))]
pub(super) fn recycle(_owner: usize, _paths: &[PathBuf]) -> Result<Outcome, String> {
    Err("The Recycle Bin is available on Windows".into())
}

#[cfg(not(windows))]
pub(super) fn eject(_owner: usize, _paths: &[PathBuf]) -> Result<Outcome, String> {
    Err("Ejecting from the Shelf is available on Windows".into())
}

#[cfg(windows)]
mod native {
    use super::*;
    use std::{collections::HashSet, os::windows::ffi::OsStrExt};
    use windows::{
        core::{PCSTR, PCWSTR, PSTR},
        Win32::{
            Foundation::{ERROR_CANCELLED, HWND},
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
                COINIT_APARTMENTTHREADED,
            },
            UI::{
                Shell::{
                    BHID_SFUIObject, FileOperation, IContextMenu, IFileOperation, IShellItem,
                    SHCreateItemFromParsingName, SHOpenWithDialog, CMF_NORMAL, CMINVOKECOMMANDINFO,
                    FILEOPERATION_FLAGS, FOFX_ADDUNDORECORD, FOFX_RECYCLEONDELETE, FOF_ALLOWUNDO,
                    FOF_NOCONFIRMMKDIR, FOF_RENAMEONCOLLISION, FOF_WANTNUKEWARNING, GCS_VERBA,
                    OAIF_ALLOW_REGISTRATION, OAIF_EXEC, OPENASINFO,
                },
                WindowsAndMessaging::{CreatePopupMenu, DestroyMenu, HMENU, SW_SHOWNORMAL},
            },
        },
    };

    struct Apartment;

    impl Apartment {
        fn open() -> windows::core::Result<Self> {
            unsafe {
                CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
            }
            Ok(Self)
        }
    }

    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe {
                CoUninitialize();
            }
        }
    }

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    fn hwnd(owner: usize) -> HWND {
        HWND(owner as *mut _)
    }

    fn shell_item(path: &Path) -> windows::core::Result<IShellItem> {
        let name = wide(path);
        unsafe { SHCreateItemFromParsingName(PCWSTR(name.as_ptr()), None) }
    }

    fn file_operation(
        owner: usize,
        flags: FILEOPERATION_FLAGS,
    ) -> windows::core::Result<IFileOperation> {
        unsafe {
            let operation: IFileOperation =
                CoCreateInstance(&FileOperation, None, CLSCTX_INPROC_SERVER)?;
            operation.SetOwnerWindow(hwnd(owner))?;
            operation.SetOperationFlags(flags)?;
            Ok(operation)
        }
    }

    fn distinct_paths(paths: &[PathBuf]) -> Result<Vec<&Path>, String> {
        let mut unique = HashSet::new();
        let paths: Vec<_> = paths
            .iter()
            .map(PathBuf::as_path)
            .filter(|path| unique.insert(path.to_string_lossy().to_lowercase()))
            .collect();
        for path in &paths {
            if path.parent().is_none() {
                return Err("Select an item below the drive root".into());
            }
            if paths
                .iter()
                .any(|folder| path != folder && path.starts_with(folder))
            {
                return Err("Drop a folder or its contents in a single operation".into());
            }
        }
        Ok(paths)
    }

    fn finish(operation: IFileOperation, paths: &[&Path]) -> Result<Option<usize>, String> {
        let result = unsafe { operation.PerformOperations() };
        let aborted = unsafe { operation.GetAnyOperationsAborted() }
            .map_err(|error| error.to_string())?
            .as_bool();
        let completed = paths
            .iter()
            .filter(|path| matches!(path.try_exists(), Ok(false)))
            .count();
        if aborted || result.is_err() || completed != paths.len() {
            if aborted && completed == 0 && result.is_ok() {
                return Ok(None);
            }
            let detail = result
                .err()
                .map(|error| format!(" {error}"))
                .unwrap_or_default();
            return Err(format!(
                "Windows processed {completed} of {} items.{detail}",
                paths.len()
            ));
        }
        Ok(Some(completed))
    }

    pub(crate) fn move_items(
        owner: usize,
        paths: &[PathBuf],
        folder: &Path,
    ) -> Result<Outcome, String> {
        let paths = distinct_paths(paths)?;
        if !folder.is_dir()
            || paths
                .iter()
                .any(|path| folder.starts_with(path) || path.parent() == Some(folder))
        {
            return Err(
                "Choose a different destination folder outside the files being moved".into(),
            );
        }
        let _apartment = Apartment::open().map_err(|error| error.to_string())?;
        let operation = file_operation(
            owner,
            FOF_RENAMEONCOLLISION | FOF_NOCONFIRMMKDIR | FOF_ALLOWUNDO | FOFX_ADDUNDORECORD,
        )
        .map_err(|error| error.to_string())?;
        let destination = shell_item(folder).map_err(|error| error.to_string())?;
        for path in &paths {
            let item = shell_item(path).map_err(|error| error.to_string())?;
            unsafe { operation.MoveItem(&item, &destination, PCWSTR::null(), None) }
                .map_err(|error| error.to_string())?;
        }
        Ok(finish(operation, &paths)?.map_or(Outcome::Cancelled, |count| Outcome::Moved { count }))
    }

    pub(crate) fn open_with(owner: usize, paths: &[PathBuf]) -> Result<Outcome, String> {
        if paths.len() != 1 || !paths[0].is_file() {
            return Err("Drop one file to choose an app for it".into());
        }
        let _apartment = Apartment::open().map_err(|error| error.to_string())?;
        let path = wide(&paths[0]);
        let settings = OPENASINFO {
            pcszFile: PCWSTR(path.as_ptr()),
            pcszClass: PCWSTR::null(),
            oaifInFlags: OAIF_ALLOW_REGISTRATION | OAIF_EXEC,
        };
        match unsafe { SHOpenWithDialog(Some(hwnd(owner)), &settings) } {
            Ok(()) => Ok(Outcome::Opened),
            Err(error) if error.code() == ERROR_CANCELLED.to_hresult() => Ok(Outcome::Cancelled),
            Err(error) => Err(error.to_string()),
        }
    }

    fn fixed_drive(path: &Path) -> bool {
        use windows_sys::Win32::{
            Storage::FileSystem::{GetDriveTypeW, GetVolumePathNameW},
            System::WindowsProgramming::DRIVE_FIXED,
        };
        let name = wide(path);
        let mut root = vec![0u16; 32_768];
        unsafe {
            GetVolumePathNameW(name.as_ptr(), root.as_mut_ptr(), root.len() as u32) != 0
                && GetDriveTypeW(root.as_ptr()) == DRIVE_FIXED
        }
    }

    pub(crate) fn recycle(owner: usize, paths: &[PathBuf]) -> Result<Outcome, String> {
        let paths = distinct_paths(paths)?;
        if paths.iter().any(|path| !fixed_drive(path)) {
            return Err("Choose an item on a local drive with a Recycle Bin".into());
        }
        let _apartment = Apartment::open().map_err(|error| error.to_string())?;
        let operation = file_operation(
            owner,
            FOF_ALLOWUNDO | FOFX_ADDUNDORECORD | FOFX_RECYCLEONDELETE | FOF_WANTNUKEWARNING,
        )
        .map_err(|error| error.to_string())?;
        for path in &paths {
            let item = shell_item(path).map_err(|error| error.to_string())?;
            unsafe { operation.DeleteItem(&item, None) }.map_err(|error| error.to_string())?;
        }
        Ok(finish(operation, &paths)?
            .map_or(Outcome::Cancelled, |count| Outcome::Recycled { count }))
    }

    fn drive_letter(path: &Path) -> Option<u8> {
        use std::path::{Component, Prefix};
        match (path.components().next()?, path.parent()) {
            (Component::Prefix(prefix), None) if path.has_root() => match prefix.kind() {
                Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => Some(letter),
                _ => None,
            },
            _ => None,
        }
    }

    pub(crate) fn eject(owner: usize, paths: &[PathBuf]) -> Result<Outcome, String> {
        use windows_sys::Win32::{
            Storage::FileSystem::GetDriveTypeW,
            System::{
                SystemInformation::GetSystemWindowsDirectoryW,
                WindowsProgramming::{DRIVE_CDROM, DRIVE_FIXED, DRIVE_REMOVABLE},
            },
        };
        let [drive] = paths else {
            return Err("Drop one drive from This PC to eject it".into());
        };
        let letter = drive_letter(drive).ok_or("Drop the drive itself from This PC")?;
        let mut windows_directory = [0u16; 260];
        let length = unsafe {
            GetSystemWindowsDirectoryW(
                windows_directory.as_mut_ptr(),
                windows_directory.len() as u32,
            )
        };
        if length < 3
            || length as usize >= windows_directory.len()
            || windows_directory[1] != u16::from(b':')
        {
            return Err("Could not identify the Windows system drive".into());
        }
        if u8::try_from(windows_directory[0])
            .is_ok_and(|system_drive| system_drive.eq_ignore_ascii_case(&letter))
        {
            return Err("The Windows system drive cannot be ejected".into());
        }
        let root = wide(drive);
        if !matches!(
            unsafe { GetDriveTypeW(root.as_ptr()) },
            DRIVE_REMOVABLE | DRIVE_FIXED | DRIVE_CDROM
        ) {
            return Err("This drive does not support Windows eject".into());
        }

        struct Menu(HMENU);
        impl Drop for Menu {
            fn drop(&mut self) {
                let _ = unsafe { DestroyMenu(self.0) };
            }
        }
        let _apartment = Apartment::open().map_err(|error| error.to_string())?;
        let item = shell_item(drive).map_err(|error| error.to_string())?;
        let commands: IContextMenu = unsafe { item.BindToHandler(None, &BHID_SFUIObject) }
            .map_err(|error| error.to_string())?;
        let menu = Menu(unsafe { CreatePopupMenu() }.map_err(|error| error.to_string())?);
        let result = unsafe { commands.QueryContextMenu(menu.0, 0, 1, 0x7fff, CMF_NORMAL) };
        result.ok().map_err(|error| error.to_string())?;
        // The low word is the number of command identifiers reserved by the shell.
        let count = result.0 as usize & 0xffff;
        let command = (0..count)
            .find(|&offset| {
                let mut verb = [0u8; 64];
                let valid = unsafe {
                    commands.GetCommandString(
                        offset,
                        GCS_VERBA,
                        None,
                        PSTR(verb.as_mut_ptr()),
                        verb.len() as u32,
                    )
                }
                .is_ok();
                let end = verb
                    .iter()
                    .position(|&byte| byte == 0)
                    .unwrap_or(verb.len());
                valid && verb[..end].eq_ignore_ascii_case(b"eject")
            })
            .ok_or("Windows does not offer Eject for this drive")?;
        let invocation = CMINVOKECOMMANDINFO {
            cbSize: std::mem::size_of::<CMINVOKECOMMANDINFO>() as u32,
            hwnd: hwnd(owner),
            lpVerb: PCSTR(command as *const u8),
            nShow: SW_SHOWNORMAL.0,
            ..Default::default()
        };
        unsafe { commands.InvokeCommand(&invocation) }.map_err(|error| error.to_string())?;
        Ok(Outcome::EjectRequested {
            drive: format!("{}:", char::from(letter)),
        })
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn eject_rejects_folders_and_cannot_eject_the_system_drive() {
        let folder = tempfile::tempdir().unwrap();
        let error = eject(0, &[folder.path().to_path_buf()]).err().unwrap();
        assert_eq!(error, "Drop the drive itself from This PC");
        let windows = PathBuf::from(std::env::var_os("SystemRoot").unwrap());
        let system_drive = windows.ancestors().last().unwrap();
        let error = eject(0, &[system_drive.to_path_buf()]).err().unwrap();
        assert_eq!(error, "The Windows system drive cannot be ejected");
    }

    #[test]
    fn move_keeps_both_files_when_the_destination_name_already_exists() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("fixture.txt");
        let destination = root.path().join("destination");
        fs::create_dir(&destination).unwrap();
        fs::write(&source, b"moving").unwrap();
        fs::write(destination.join("fixture.txt"), b"existing").unwrap();

        let outcome = move_items(0, std::slice::from_ref(&source), &destination).unwrap();
        assert!(matches!(outcome, Outcome::Moved { count: 1 }));
        assert!(!source.exists());
        assert_eq!(
            fs::read(destination.join("fixture.txt")).unwrap(),
            b"existing"
        );
        let other = fs::read_dir(&destination)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|path| path.file_name().unwrap() != "fixture.txt")
            .expect("Windows should choose a unique name");
        assert_eq!(fs::read(other).unwrap(), b"moving");
    }
}
