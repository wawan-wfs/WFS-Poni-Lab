use crate::{bookmarks, Store};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use uuid::Uuid;

const MAX_ITEMS: usize = 200;
const MAX_TEXT_BYTES: usize = 64 * 1024;

#[derive(Clone, Deserialize, Serialize)]
#[serde(default)]
pub(super) struct Preferences {
    pub(super) enabled: bool,
    open_on_drag: bool,
    remove_after_drag: bool,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            enabled: true,
            open_on_drag: true,
            remove_after_drag: false,
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct PreferencesPatch {
    enabled: Option<bool>,
    open_on_drag: Option<bool>,
    remove_after_drag: Option<bool>,
}

impl Preferences {
    pub(super) fn apply(&mut self, patch: PreferencesPatch) {
        self.enabled = patch.enabled.unwrap_or(self.enabled);
        self.open_on_drag = patch.open_on_drag.unwrap_or(self.open_on_drag);
        self.remove_after_drag = patch.remove_after_drag.unwrap_or(self.remove_after_drag);
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
enum Content {
    File { path: PathBuf },
    Link { text: String },
    Text { text: String },
}

#[derive(Clone, Deserialize, Serialize)]
struct Item {
    id: Uuid,
    #[serde(flatten)]
    content: Content,
}

#[derive(Clone, Default, Deserialize, Serialize)]
pub(super) struct Shelf {
    items: Vec<Item>,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub(super) enum Input {
    File { path: PathBuf },
    Text { text: String },
}

#[derive(Clone, Serialize)]
pub(super) struct Card {
    #[serde(flatten)]
    item: Item,
    name: String,
    directory: bool,
    missing: bool,
    size: Option<u64>,
}

impl Content {
    fn from_input(input: Input) -> Result<Self, String> {
        match input {
            Input::File { path } => {
                if !path.is_absolute() {
                    return Err("Choose a file or folder with an absolute path".into());
                }
                let path = dunce::canonicalize(path)
                    .map_err(|error| format!("Could not find the file or folder: {error}"))?;
                if !path.is_file() && !path.is_dir() {
                    return Err("Choose a file or folder".into());
                }
                Ok(Self::File { path })
            }
            Input::Text { text } => {
                let text = text.trim();
                if text.is_empty() || text.len() > MAX_TEXT_BYTES {
                    return Err("Shelf text must be nonempty and at most 64 KB".into());
                }
                let link = text
                    .get(..8)
                    .is_some_and(|prefix| prefix.eq_ignore_ascii_case("https://"))
                    || text
                        .get(..7)
                        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("http://"));
                if link {
                    if let Ok(url) = bookmarks::web_url(text) {
                        return Ok(Self::Link {
                            text: url.to_string(),
                        });
                    }
                }
                Ok(Self::Text { text: text.into() })
            }
        }
    }

    fn copy_text(&self) -> String {
        match self {
            Self::File { path } => path.display().to_string(),
            Self::Link { text } | Self::Text { text } => text.clone(),
        }
    }
}

impl From<Item> for Card {
    fn from(item: Item) -> Self {
        let mut card = Self {
            item,
            name: String::new(),
            directory: false,
            missing: false,
            size: None,
        };
        match &card.item.content {
            Content::File { path } => {
                card.name = path
                    .file_name()
                    .unwrap_or(path.as_os_str())
                    .to_string_lossy()
                    .into_owned();
                match path.metadata() {
                    Ok(metadata) if metadata.is_dir() => card.directory = true,
                    Ok(metadata) if metadata.is_file() => card.size = Some(metadata.len()),
                    _ => card.missing = true,
                }
            }
            Content::Link { text } => {
                card.name = text
                    .strip_prefix("https://")
                    .or_else(|| text.strip_prefix("http://"))
                    .unwrap_or(text)
                    .trim_end_matches('/')
                    .chars()
                    .take(100)
                    .collect();
            }
            Content::Text { text } => {
                card.name = text
                    .lines()
                    .find(|line| !line.trim().is_empty())
                    .unwrap_or(text)
                    .chars()
                    .take(100)
                    .collect();
            }
        }
        card
    }
}

impl Shelf {
    fn cards(self) -> Vec<Card> {
        self.items.into_iter().map(Card::from).collect()
    }

    fn add(&mut self, items: Vec<Content>) -> Result<(), String> {
        for content in items {
            if self.items.iter().any(|item| item.content == content) {
                continue;
            }
            if self.items.len() >= MAX_ITEMS {
                return Err(format!("The Shelf can hold up to {MAX_ITEMS} items"));
            }
            self.items.push(Item {
                id: Uuid::new_v4(),
                content,
            });
        }
        Ok(())
    }
}

fn add_items(app: &AppHandle, input: Vec<Input>) -> Result<Vec<Card>, String> {
    if input.len() > MAX_ITEMS {
        return Err(format!("Add at most {MAX_ITEMS} items at a time"));
    }
    let items = input
        .into_iter()
        .map(Content::from_input)
        .collect::<Result<Vec<_>, _>>()?;
    let store = app.state::<Mutex<Store>>();
    let data = store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            if !data.settings.shelf.enabled {
                return Err("Enable the Shelf from Settings first".into());
            }
            data.shelf.add(items)
        })?;
    Ok(data.shelf.cards())
}

#[tauri::command]
pub(super) async fn shelf_items(app: AppHandle) -> Result<Vec<Card>, String> {
    let store = app.state::<Mutex<Store>>();
    let shelf = store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .data
        .shelf
        .clone();
    Ok(shelf.cards())
}

#[derive(Default)]
pub(super) struct Dragging(AtomicBool);

#[tauri::command]
pub(super) async fn shelf_add(app: AppHandle, items: Vec<Input>) -> Result<Vec<Card>, String> {
    if app.state::<Dragging>().0.load(Ordering::Relaxed) {
        return shelf_items(app).await;
    }
    add_items(&app, items)
}

#[tauri::command]
pub(super) async fn shelf_pick(window: WebviewWindow, folders: bool) -> Result<Vec<Card>, String> {
    let app = window.app_handle();
    #[cfg(windows)]
    {
        let picker = rfd::AsyncFileDialog::new().set_parent(&window);
        let paths = if folders {
            picker.pick_folders().await
        } else {
            picker.pick_files().await
        };
        if let Some(paths) = paths {
            return add_items(
                app,
                paths
                    .into_iter()
                    .map(|item| Input::File {
                        path: item.path().to_owned(),
                    })
                    .collect(),
            );
        }
        return shelf_items(app.clone()).await;
    }
    #[cfg(not(windows))]
    {
        let _ = (app, folders);
        Err("The native Shelf picker is available on Windows".into())
    }
}

#[tauri::command]
pub(super) async fn shelf_paste(app: AppHandle) -> Result<Vec<Card>, String> {
    #[cfg(windows)]
    {
        let text =
            clipboard_win::get_clipboard_string().map_err(|_| "Clipboard text is unavailable")?;
        add_items(&app, vec![Input::Text { text }])
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("The native Shelf clipboard is available on Windows".into())
    }
}

fn remove_items(app: &AppHandle, ids: Option<Vec<Uuid>>) -> Result<Vec<Card>, String> {
    let store = app.state::<Mutex<Store>>();
    let data = store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            if let Some(ids) = &ids {
                data.shelf.items.retain(|item| !ids.contains(&item.id));
            } else {
                data.shelf.items.clear();
            }
            Ok(())
        })?;
    Ok(data.shelf.cards())
}

#[tauri::command]
pub(super) async fn shelf_remove(
    app: AppHandle,
    ids: Option<Vec<Uuid>>,
) -> Result<Vec<Card>, String> {
    remove_items(&app, ids)
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum ItemAction {
    Open,
    Reveal,
    Copy,
}

#[tauri::command]
pub(super) async fn shelf_item_action(
    store: State<'_, Mutex<Store>>,
    id: Uuid,
    action: ItemAction,
) -> Result<(), String> {
    let content = store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .data
        .shelf
        .items
        .iter()
        .find(|item| item.id == id)
        .map(|item| item.content.clone())
        .ok_or("Shelf item not found")?;
    match (action, &content) {
        (ItemAction::Open, Content::File { path }) => file_action(path, false),
        (ItemAction::Open, Content::Link { text }) => {
            bookmarks::open_in_default_browser(bookmarks::web_url(text)?)
        }
        (ItemAction::Reveal, Content::File { path }) => file_action(path, true),
        (ItemAction::Reveal, _) => Err("Only files or folders have a location".into()),
        _ => copy_to_clipboard(&content.copy_text()),
    }
}

#[cfg(windows)]
fn copy_to_clipboard(text: &str) -> Result<(), String> {
    clipboard_win::set_clipboard_string(text).map_err(|_| "Could not write to the clipboard".into())
}

#[cfg(not(windows))]
fn copy_to_clipboard(_text: &str) -> Result<(), String> {
    Err("The native Shelf clipboard is available on Windows".into())
}

#[cfg(windows)]
fn file_action(path: &Path, reveal: bool) -> Result<(), String> {
    use std::{os::windows::ffi::OsStrExt, ptr::null};
    use windows_sys::Win32::{
        System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED},
        UI::{
            Shell::{ILCreateFromPathW, ILFree, SHOpenFolderAndSelectItems, ShellExecuteW},
            WindowsAndMessaging::SW_SHOWNORMAL,
        },
    };
    if !path.is_file() && !path.is_dir() {
        return Err("The item has moved or is unavailable".into());
    }
    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        if reveal {
            let initialized = CoInitializeEx(null(), COINIT_APARTMENTTHREADED as u32) >= 0;
            let pidl = ILCreateFromPathW(wide.as_ptr());
            let result = if pidl.is_null() {
                false
            } else {
                let opened = SHOpenFolderAndSelectItems(pidl, 0, null(), 0) >= 0;
                ILFree(pidl);
                opened
            };
            if initialized {
                CoUninitialize();
            }
            if !result {
                return Err("Could not show the item in File Explorer".into());
            }
        } else if ShellExecuteW(
            std::ptr::null_mut(),
            null(),
            wide.as_ptr(),
            null(),
            null(),
            SW_SHOWNORMAL,
        ) as isize
            <= 32
        {
            return Err("Could not open the item with its default app".into());
        }
    }
    Ok(())
}

#[cfg(not(windows))]
fn file_action(_path: &Path, _reveal: bool) -> Result<(), String> {
    Err("The native Shelf file actions are available on Windows".into())
}

#[tauri::command]
pub(super) fn shelf_drag(window: WebviewWindow, ids: Vec<Uuid>) -> Result<(), String> {
    #[cfg(windows)]
    {
        if window.label() != "main" {
            return Err("Drag items from the Shelf in the main window".into());
        }
        let app = window.app_handle().clone();
        let store = app.state::<Mutex<Store>>();
        let store = store.lock().map_err(|_| "Storage unavailable")?;
        if !store.data.settings.shelf.enabled {
            return Err("Enable the Shelf from Settings first".into());
        }
        let files: Vec<_> = store
            .data
            .shelf
            .items
            .iter()
            .filter_map(|item| match &item.content {
                Content::File { path } if ids.contains(&item.id) => Some((item.id, path.clone())),
                _ => None,
            })
            .collect();
        drop(store);
        if files.is_empty() {
            return Err("Choose at least one file or folder to drag".into());
        }
        let state = app.state::<Dragging>();
        if state.0.swap(true, Ordering::AcqRel) {
            return Err("A Shelf drag is already running".into());
        }
        let source = window.clone();
        let drag_app = app.clone();
        if let Err(error) = window.run_on_main_thread(move || {
            let (ids, paths): (Vec<Uuid>, Vec<PathBuf>) = files.into_iter().unzip();
            let notify = drag_app.clone();
            let bounds = source.inner_position().ok().zip(source.inner_size().ok());
            let result = drag::start_drag(
                &source,
                drag::DragItem::Files(paths),
                drag::Image::Raw(include_bytes!("../icons/icon.png").to_vec()),
                move |result, point| {
                    let outside = bounds.is_some_and(|(origin, size)| {
                        point.x < origin.x
                            || point.y < origin.y
                            || i64::from(point.x) >= i64::from(origin.x) + i64::from(size.width)
                            || i64::from(point.y) >= i64::from(origin.y) + i64::from(size.height)
                    });
                    if !outside || !matches!(result, drag::DragResult::Dropped) {
                        return;
                    }
                    let store = notify.state::<Mutex<Store>>();
                    let remove = store
                        .lock()
                        .is_ok_and(|store| store.data.settings.shelf.remove_after_drag);
                    if remove {
                        match remove_items(&notify, Some(ids.clone())) {
                            Ok(cards) => {
                                let _ = notify.emit_to("main", "poni-shelf-items", cards);
                            }
                            Err(error) => {
                                let _ = notify.emit_to("main", "poni-shelf-drag-error", error);
                            }
                        }
                    }
                },
                drag::Options::default(),
            );
            drag_app
                .state::<Dragging>()
                .0
                .store(false, Ordering::Release);
            if let Err(error) = result {
                let _ = drag_app.emit_to("main", "poni-shelf-drag-error", error.to_string());
            }
        }) {
            state.0.store(false, Ordering::Release);
            return Err(error.to_string());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (window, ids);
        Err("Dragging files out of the Shelf is available on Windows".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_references_deduplicates_and_reports_missing_files() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("file.txt");
        std::fs::write(&path, "hello").unwrap();
        let input = Content::from_input(Input::File { path: path.clone() }).unwrap();
        let mut shelf = Shelf::default();
        shelf.add(vec![input.clone(), input]).unwrap();
        assert_eq!(shelf.items.len(), 1);
        let saved = serde_json::to_string(&shelf).unwrap();
        assert_eq!(
            serde_json::from_str::<Shelf>(&saved).unwrap().cards()[0].size,
            Some(5)
        );
        std::fs::rename(&path, folder.path().join("moved.txt")).unwrap();
        assert!(shelf.cards()[0].missing);
    }

    #[test]
    fn keeps_only_explicit_http_addresses_as_links() {
        for text in [
            "javascript:alert(1)",
            "example.com",
            "https://user:password@example.com",
            r"https://example.com\bad",
        ] {
            assert!(matches!(
                Content::from_input(Input::Text { text: text.into() }).unwrap(),
                Content::Text { .. }
            ));
        }
        assert!(
            matches!(Content::from_input(Input::Text { text: " https://Example.com/a ".into() }).unwrap(), Content::Link { text } if text == "https://example.com/a")
        );
    }
}
