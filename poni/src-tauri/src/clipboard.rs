use crate::{shelf::Preferences, Store};
use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

const MAX_PINS: usize = 100;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
enum Content {
    Text {
        text: String,
    },
    Link {
        text: String,
    },
    Image {
        width: u32,
        height: u32,
        fingerprint: String,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct Entry {
    id: Uuid,
    copied_at_ms: u64,
    pinned: bool,
    #[serde(flatten)]
    content: Content,
}

pub(super) struct History {
    profile: PathBuf,
    entries: Result<Vec<Entry>, String>,
}

fn trim(entries: &mut Vec<Entry>, limit: usize) {
    entries.sort_by_key(|entry| {
        (
            std::cmp::Reverse(entry.pinned),
            std::cmp::Reverse(entry.copied_at_ms),
        )
    });
    let mut recent = 0;
    entries.retain(|entry| {
        if entry.pinned {
            return true;
        }
        recent += 1;
        recent <= limit
    });
}

impl History {
    pub(super) fn open(profile: PathBuf) -> Self {
        let entries = match fs::read(profile.join("clipboard.json")) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|error| format!("Cannot read clipboard history: {error}")),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(error) => Err(format!("Cannot read clipboard history: {error}")),
        };
        Self { profile, entries }
    }

    fn entries(&self) -> Result<&Vec<Entry>, String> {
        self.entries.as_ref().map_err(Clone::clone)
    }

    fn image_path(&self, id: Uuid) -> PathBuf {
        self.profile
            .join("clipboard-media")
            .join(format!("{id}.png"))
    }

    fn save(&mut self, next: Vec<Entry>) -> Result<bool, String> {
        let current = self.entries()?;
        if *current == next {
            return Ok(false);
        }
        fs::create_dir_all(&self.profile).map_err(|error| error.to_string())?;
        let mut file =
            tempfile::NamedTempFile::new_in(&self.profile).map_err(|error| error.to_string())?;
        serde_json::to_writer(&mut file, &next).map_err(|error| error.to_string())?;
        file.flush()
            .and_then(|()| file.as_file().sync_all())
            .map_err(|error| error.to_string())?;
        file.persist(self.profile.join("clipboard.json"))
            .map_err(|error| error.to_string())?;
        for entry in current {
            if matches!(entry.content, Content::Image { .. })
                && !next.iter().any(|item| item.id == entry.id)
            {
                let _ = fs::remove_file(self.image_path(entry.id));
            }
        }
        self.entries = Ok(next);
        Ok(true)
    }
}

fn active_limit(preferences: &Preferences) -> usize {
    if preferences.enabled {
        retention_limit(preferences)
    } else {
        0
    }
}

fn retention_limit(preferences: &Preferences) -> usize {
    if preferences.clipboard_enabled {
        usize::from(preferences.clipboard_limit)
    } else {
        0
    }
}

pub(super) fn reconcile(app: &AppHandle) {
    let Some(storage) = app.try_state::<Mutex<History>>() else {
        return;
    };
    let store = app.state::<Mutex<Store>>();
    let Ok(store) = store.lock() else { return };
    let limit = retention_limit(&store.data.settings.shelf);
    let Ok(mut history) = storage.lock() else {
        return;
    };
    let Ok(entries) = history.entries() else {
        return;
    };
    let mut updated = entries.clone();
    trim(&mut updated, limit);
    if history.save(updated).unwrap_or(false) {
        let _ = app.emit_to("main", "poni-clipboard-changed", ());
    }
}

#[tauri::command]
pub(super) async fn clipboard_history(app: AppHandle) -> Result<Vec<Entry>, String> {
    let store = app.state::<Mutex<Store>>();
    let limit = active_limit(
        &store
            .lock()
            .map_err(|_| "Storage unavailable")?
            .data
            .settings
            .shelf,
    );
    if limit == 0 {
        return Ok(Vec::new());
    }
    let storage = app.state::<Mutex<History>>();
    let history = storage
        .lock()
        .map_err(|_| "Clipboard history unavailable")?;
    Ok(history.entries()?.clone())
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Action {
    Copy,
    Pin,
    Unpin,
    Remove,
    Clear,
}

#[tauri::command]
pub(super) async fn clipboard_history_action(
    app: AppHandle,
    action: Action,
    id: Option<Uuid>,
) -> Result<(), String> {
    let store = app.state::<Mutex<Store>>();
    let store = store.lock().map_err(|_| "Storage unavailable")?;
    let limit = active_limit(&store.data.settings.shelf);
    if limit == 0 {
        return Err("Enable Clipboard history in Settings first".into());
    }
    let storage = app.state::<Mutex<History>>();
    let mut history = storage
        .lock()
        .map_err(|_| "Clipboard history unavailable")?;
    let mut entries = history.entries()?.clone();
    if matches!(action, Action::Clear) {
        entries.retain(|entry| entry.pinned);
    } else {
        let index = entries
            .iter()
            .position(|entry| Some(entry.id) == id)
            .ok_or("Clipboard entry unavailable")?;
        match action {
            Action::Copy => {
                let entry = entries.remove(index);
                let path = history.image_path(entry.id);
                drop(history);
                drop(store);
                return match entry.content {
                    Content::Text { text } | Content::Link { text } => {
                        crate::shelf::copy_to_clipboard(&text)
                    }
                    Content::Image { .. } => copy_image(path),
                };
            }
            Action::Pin => {
                if entries.iter().filter(|entry| entry.pinned).count() >= MAX_PINS {
                    return Err("There are already 100 pinned copies".into());
                }
                entries[index].pinned = true;
            }
            Action::Unpin => entries[index].pinned = false,
            Action::Remove => {
                entries.remove(index);
            }
            Action::Clear => unreachable!(),
        }
    }
    trim(&mut entries, limit);
    if history.save(entries)? {
        let _ = app.emit_to("main", "poni-clipboard-changed", ());
    }
    Ok(())
}

#[tauri::command]
pub(super) async fn clipboard_image(
    app: AppHandle,
    id: Uuid,
) -> Result<tauri::ipc::Response, String> {
    let store = app.state::<Mutex<Store>>();
    let limit = active_limit(
        &store
            .lock()
            .map_err(|_| "Storage unavailable")?
            .data
            .settings
            .shelf,
    );
    if limit == 0 {
        return Err("Clipboard history is disabled".into());
    }
    let storage = app.state::<Mutex<History>>();
    let history = storage
        .lock()
        .map_err(|_| "Clipboard history unavailable")?;
    if !history
        .entries()?
        .iter()
        .any(|item| item.id == id && matches!(item.content, Content::Image { .. }))
    {
        return Err("Clipboard image unavailable".into());
    }
    let bytes = fs::read(history.image_path(id)).map_err(|error| error.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(not(windows))]
fn copy_image(_path: PathBuf) -> Result<(), String> {
    Err("The native clipboard is available on Windows".into())
}

#[cfg(windows)]
use windows_clipboard::copy_image;

#[cfg(windows)]
pub(super) use windows_clipboard::monitor;

#[cfg(windows)]
mod windows_clipboard {
    use super::*;
    use clipboard_win::{formats, get, is_format_avail, register_format, Clipboard};
    use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, Limits};
    use sha2::{Digest, Sha256};
    use std::{io::Cursor, time::Duration};

    const MAX_IMAGE: usize = 8 * 1024 * 1024;
    const MAX_TEXT: usize = 64 * 1024;

    struct Formats {
        private: Vec<u32>,
        png: Option<u32>,
    }

    impl Formats {
        fn load() -> Self {
            let private = [
                "ExcludeClipboardContentFromMonitorProcessing",
                "Clipboard Viewer Ignore",
                "CanIncludeInClipboardHistory",
                "Shell IDList Array",
            ]
            .into_iter()
            .filter_map(register_format)
            .map(Into::into)
            .collect();
            Self {
                private,
                png: register_format("PNG").map(Into::into),
            }
        }
    }

    fn decode_image(raw: &[u8], png: bool) -> image::ImageResult<DynamicImage> {
        let mut limits = Limits::default();
        limits.max_image_width = Some(4096);
        limits.max_image_height = Some(4096);
        limits.max_alloc = Some(64 * 1024 * 1024);
        if png {
            let mut reader = ImageReader::with_format(Cursor::new(raw), ImageFormat::Png);
            reader.limits(limits);
            reader.decode()
        } else {
            let mut decoder =
                image::codecs::bmp::BmpDecoder::new_without_file_header(Cursor::new(raw))?;
            decoder.set_limits(limits)?;
            DynamicImage::from_decoder(decoder)
        }
    }

    fn read_clipboard(
        supported: &Formats,
    ) -> Result<Option<(Content, Option<Vec<u8>>)>, clipboard_win::ErrorCode> {
        let _board = Clipboard::new_attempts(2)?;
        if is_format_avail(formats::CF_HDROP)
            || supported
                .private
                .iter()
                .any(|&format| is_format_avail(format))
        {
            return Ok(None);
        }
        for format in [
            supported.png,
            Some(formats::CF_DIBV5),
            Some(formats::CF_DIB),
        ]
        .into_iter()
        .flatten()
        {
            if !is_format_avail(format)
                || !clipboard_win::size(format).is_some_and(|size| size.get() <= MAX_IMAGE)
            {
                continue;
            }
            let raw: Vec<u8> = get(formats::RawData(format))?;
            if let Ok(image) = decode_image(&raw, Some(format) == supported.png) {
                let mut bytes = Cursor::new(Vec::new());
                if image.write_to(&mut bytes, ImageFormat::Png).is_ok()
                    && bytes.get_ref().len() <= MAX_IMAGE
                {
                    let data = bytes.into_inner();
                    let content = Content::Image {
                        width: image.width(),
                        height: image.height(),
                        fingerprint: format!("{:x}", Sha256::digest(&data)),
                    };
                    return Ok(Some((content, Some(data))));
                }
            }
        }
        if is_format_avail(formats::CF_UNICODETEXT)
            && clipboard_win::size(formats::CF_UNICODETEXT)
                .is_some_and(|size| size.get() <= MAX_TEXT * 2)
        {
            let text: String = get(formats::Unicode)?;
            if !text.trim().is_empty() && text.len() <= MAX_TEXT {
                let link = text.starts_with("https://") || text.starts_with("http://");
                let content = if link && crate::bookmarks::web_url(&text).is_ok() {
                    Content::Link { text }
                } else {
                    Content::Text { text }
                };
                return Ok(Some((content, None)));
            }
        }
        Ok(None)
    }

    fn record(app: &AppHandle, content: Content, image: Option<Vec<u8>>) -> Result<(), String> {
        let store = app.state::<Mutex<Store>>();
        let store = store.lock().map_err(|_| "Storage unavailable")?;
        let limit = active_limit(&store.data.settings.shelf);
        if limit == 0 {
            return Ok(());
        }
        let storage = app.state::<Mutex<History>>();
        let mut history = storage
            .lock()
            .map_err(|_| "Clipboard history unavailable")?;
        let mut next = history.entries()?.clone();
        if let Some(entry) = next.iter_mut().find(|entry| entry.content == content) {
            entry.copied_at_ms = crate::now_ms()?;
        } else {
            let id = Uuid::new_v4();
            let entry = Entry {
                id,
                copied_at_ms: crate::now_ms()?,
                pinned: false,
                content,
            };
            if let Some(bytes) = image {
                let path = history.image_path(id);
                let directory = path.parent().ok_or("Invalid clipboard image path")?;
                fs::create_dir_all(directory).map_err(|error| error.to_string())?;
                let mut file = tempfile::NamedTempFile::new_in(directory)
                    .map_err(|error| error.to_string())?;
                file.write_all(&bytes)
                    .and_then(|()| file.as_file().sync_all())
                    .map_err(|error| error.to_string())?;
                file.persist(&path).map_err(|error| error.to_string())?;
                next.push(entry);
                trim(&mut next, limit);
                if let Err(error) = history.save(next) {
                    let _ = fs::remove_file(path);
                    return Err(error);
                }
                let _ = app.emit_to("main", "poni-clipboard-changed", ());
                return Ok(());
            }
            next.push(entry);
        }
        trim(&mut next, limit);
        if history.save(next)? {
            let _ = app.emit_to("main", "poni-clipboard-changed", ());
        }
        Ok(())
    }

    pub(crate) fn monitor(app: AppHandle) {
        super::reconcile(&app);
        let mut previous = clipboard_win::seq_num();
        let supported = Formats::load();
        loop {
            std::thread::sleep(Duration::from_millis(750));
            let current = clipboard_win::seq_num();
            if current.is_none() || current == previous {
                continue;
            }
            let store = app.state::<Mutex<Store>>();
            let enabled = store
                .lock()
                .is_ok_and(|store| active_limit(&store.data.settings.shelf) > 0);
            if !enabled {
                previous = current;
                continue;
            }
            if let Ok(capture) = read_clipboard(&supported) {
                previous = current;
                if let Some((content, image)) = capture {
                    if let Err(error) = record(&app, content, image) {
                        eprintln!("Clipboard history could not save this copy: {error}");
                    }
                }
            }
        }
    }

    pub(super) fn copy_image(path: PathBuf) -> Result<(), String> {
        let bytes = fs::read(path).map_err(|error| error.to_string())?;
        let image = decode_image(&bytes, true).map_err(|error| error.to_string())?;
        let mut bitmap = Cursor::new(Vec::new());
        image
            .write_to(&mut bitmap, ImageFormat::Bmp)
            .map_err(|error| error.to_string())?;
        let _board = Clipboard::new_attempts(10).map_err(|_| "Clipboard is unavailable")?;
        clipboard_win::set(
            formats::RawData(formats::CF_DIB),
            &bitmap.into_inner()[14..],
        )
        .map_err(|_| "Could not copy the image")?;
        if let Some(png) = register_format("PNG") {
            let _ = clipboard_win::raw::set_without_clear(png.get(), &bytes);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clearing_or_limiting_preserves_pinned_copies() {
        let profile = tempfile::tempdir().unwrap();
        let mut history = History::open(profile.path().into());
        let mut entries = (0..10)
            .map(|index| Entry {
                id: Uuid::new_v4(),
                pinned: index < 2,
                copied_at_ms: index,
                content: Content::Text {
                    text: index.to_string(),
                },
            })
            .collect::<Vec<_>>();
        trim(&mut entries, 5);
        assert_eq!(entries.len(), 7);
        assert_eq!(entries[2].copied_at_ms, 9);
        trim(&mut entries, 0);
        assert_eq!(entries.len(), 2);
        history.save(entries.clone()).unwrap();
        let saved = History::open(profile.path().into());
        assert_eq!(saved.entries().unwrap(), &entries);
    }
}
