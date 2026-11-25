use std::path::PathBuf;
use tauri::WebviewWindow;

#[cfg(not(windows))]
pub(super) fn show(
    _window: &WebviewWindow,
    _owner: usize,
    _paths: &[PathBuf],
) -> Result<(), String> {
    Err("The share panel is available on Windows".into())
}

#[cfg(windows)]
pub(super) fn show(window: &WebviewWindow, owner: usize, paths: &[PathBuf]) -> Result<(), String> {
    use std::sync::mpsc;
    let items = native::storage_items(paths).map_err(|error| error.to_string())?;
    let (send, receive) = mpsc::sync_channel(1);
    window
        .run_on_main_thread(move || {
            let result = native::show_share_ui(owner, items)
                .map_err(|error| format!("Could not open Windows Share: {error}"));
            let _ = send.send(result);
        })
        .map_err(|error| error.to_string())?;
    receive
        .recv()
        .map_err(|_| "The share window closed".to_string())?
}

#[cfg(windows)]
mod native {
    use std::{cell::RefCell, path::PathBuf};
    use windows::{
        core::{factory, AgileReference, Interface, HSTRING},
        ApplicationModel::DataTransfer::{
            DataPackageOperation, DataRequestedEventArgs, DataTransferManager,
        },
        Foundation::TypedEventHandler,
        Storage::{IStorageItem, StorageFile, StorageFolder},
        Win32::{
            Foundation::HWND,
            System::WinRT::{
                RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED, RO_INIT_SINGLETHREADED,
            },
            UI::Shell::IDataTransferManagerInterop,
        },
    };
    use windows_collections::IIterable;

    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe { RoUninitialize() };
        }
    }

    pub(super) type ShareItem = AgileReference<IStorageItem>;

    pub(super) fn storage_items(paths: &[PathBuf]) -> windows::core::Result<Vec<ShareItem>> {
        unsafe { RoInitialize(RO_INIT_MULTITHREADED)? };
        let _apartment = Apartment;
        paths
            .iter()
            .map(|path| {
                let source = HSTRING::from(path.as_os_str());
                let item: IStorageItem = if path.is_dir() {
                    StorageFolder::GetFolderFromPathAsync(&source)?
                        .get()?
                        .cast()?
                } else {
                    StorageFile::GetFileFromPathAsync(&source)?.get()?.cast()?
                };
                AgileReference::new(&item)
            })
            .collect()
    }

    struct ShareRequest {
        manager: DataTransferManager,
        token: i64,
    }

    impl Drop for ShareRequest {
        fn drop(&mut self) {
            let _ = self.manager.RemoveDataRequested(self.token);
        }
    }

    thread_local! {
        static CURRENT_REQUEST: RefCell<Option<ShareRequest>> = const { RefCell::new(None) };
    }

    pub(super) fn show_share_ui(owner: usize, items: Vec<ShareItem>) -> windows::core::Result<()> {
        unsafe { RoInitialize(RO_INIT_SINGLETHREADED)? };
        let _apartment = Apartment;
        let owner = HWND(owner as *mut _);
        let interop = factory::<DataTransferManager, IDataTransferManagerInterop>()?;
        let manager: DataTransferManager = unsafe { interop.GetForWindow(owner)? };
        CURRENT_REQUEST.with(|current| current.borrow_mut().take());
        let mut pending = Some(items);
        let event = TypedEventHandler::<DataTransferManager, DataRequestedEventArgs>::new(
            move |_, args| {
                let request = args.ok()?.Request()?;
                let Some(items) = pending.take() else {
                    return request
                        .FailWithDisplayText(&HSTRING::from("Drop the items on Share again"));
                };
                let set_data = || {
                    let data = request.Data()?;
                    let sources: IIterable<IStorageItem> = items
                        .iter()
                        .map(|item| item.resolve().map(Some))
                        .collect::<windows::core::Result<Vec<_>>>()?
                        .into();
                    data.Properties()?
                        .SetTitle(&HSTRING::from("Share from Poni"))?;
                    data.SetRequestedOperation(DataPackageOperation::Copy)?;
                    data.SetStorageItems(&sources, true)
                };
                if set_data().is_err() {
                    request.FailWithDisplayText(&HSTRING::from(
                        "Windows could not share these items",
                    ))?;
                }
                Ok(())
            },
        );
        let request = ShareRequest {
            token: manager.DataRequested(&event)?,
            manager,
        };
        unsafe { interop.ShowShareUIForWindow(owner)? };
        CURRENT_REQUEST.with(|current| current.replace(Some(request)));
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::fs;

        #[test]
        fn prepares_only_the_dropped_file_and_folder_for_the_share_sheet() {
            let root = tempfile::tempdir().unwrap();
            let folder = root.path().join("Documents");
            let file = folder.join("Notes.txt");
            fs::create_dir(&folder).unwrap();
            fs::write(&file, b"Fixture").unwrap();
            let items = storage_items(&[
                dunce::canonicalize(file).unwrap(),
                dunce::canonicalize(folder).unwrap(),
            ])
            .unwrap();
            unsafe { RoInitialize(RO_INIT_MULTITHREADED).unwrap() };
            let _apartment = Apartment;
            let items: Vec<_> = items.iter().map(|item| item.resolve().unwrap()).collect();
            assert!(items[0]
                .IsOfType(windows::Storage::StorageItemTypes::File)
                .unwrap());
            assert!(items[1]
                .IsOfType(windows::Storage::StorageItemTypes::Folder)
                .unwrap());
            let names: Vec<_> = items
                .iter()
                .map(|item| item.Name().unwrap().to_string_lossy())
                .collect();
            assert_eq!(names, ["Notes.txt", "Documents"]);
        }
    }
}
