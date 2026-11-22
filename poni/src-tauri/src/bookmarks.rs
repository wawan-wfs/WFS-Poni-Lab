use super::Store;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize)]
struct Bookmark {
    id: Uuid,
    url: String,
    title: String,
    category: Option<String>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub(crate) struct BookmarkData {
    items: Vec<Bookmark>,
    categories: Vec<String>,
}

fn web_url(input: &str) -> Result<Url, String> {
    let input = input.trim();
    let input = input
        .strip_prefix('<')
        .and_then(|rest| rest.strip_suffix('>'))
        .unwrap_or(input);
    let invalid = "Enter a valid HTTP or HTTPS link";
    if input.is_empty()
        || input.len() > 2048
        || input.contains('\\')
        || input
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
    {
        return Err(invalid.into());
    }

    let has_scheme = input
        .get(..8)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("https://"))
        || input
            .get(..7)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("http://"));
    if !has_scheme {
        if input.contains("://") {
            return Err(invalid.into());
        }
        let host = input.split(['/', '?', '#', ':']).next().unwrap_or_default();
        if !host.contains('.') || host.starts_with('.') || host.ends_with('.') {
            return Err(invalid.into());
        }
    }
    let address = if has_scheme {
        input.to_owned()
    } else {
        format!("https://{input}")
    };
    let url = Url::parse(&address).map_err(|_| invalid)?;
    if !matches!(url.scheme(), "http" | "https")
        || url.as_str().len() > 2048
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(invalid.into());
    }
    Ok(url)
}

fn category_name(name: &str) -> Result<&str, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 40 || name.chars().any(char::is_control) {
        return Err("Category must contain 1–40 characters".into());
    }
    Ok(name)
}

impl BookmarkData {
    fn find_category(&self, name: &str) -> Option<&str> {
        let key = name.to_lowercase();
        self.categories
            .iter()
            .find(|category| category.to_lowercase() == key)
            .map(String::as_str)
    }

    fn add_category(&mut self, name: &str) -> Result<String, String> {
        let name = category_name(name)?;
        if let Some(existing) = self.find_category(name) {
            return Ok(existing.to_owned());
        }
        if self.categories.len() >= 100 {
            return Err("There are already 100 bookmark categories".into());
        }
        self.categories.push(name.to_owned());
        Ok(name.to_owned())
    }
}

#[tauri::command]
pub(crate) fn list_bookmarks(store: State<'_, Mutex<Store>>) -> Result<BookmarkData, String> {
    Ok(store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .data
        .bookmarks
        .clone())
}

#[tauri::command]
pub(crate) fn save_bookmark(
    store: State<'_, Mutex<Store>>,
    id: Option<Uuid>,
    url: String,
    title: String,
    category: String,
) -> Result<BookmarkData, String> {
    let url = web_url(&url)?;
    let address = url.to_string();
    let title = title.trim();
    if title.chars().count() > 200 || title.chars().any(char::is_control) {
        return Err("Title must contain at most 200 characters".into());
    }
    let title = if title.is_empty() {
        url.host_str().unwrap_or_default().to_owned()
    } else {
        title.to_owned()
    };

    let state = store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            let bookmarks = &mut data.bookmarks;
            if bookmarks
                .items
                .iter()
                .any(|bookmark| bookmark.url == address && Some(bookmark.id) != id)
            {
                return Err("This link is already saved".into());
            }
            if id.is_none() && bookmarks.items.len() >= 1000 {
                return Err("There are already 1,000 bookmarks".into());
            }
            let category = if category.trim().is_empty() {
                None
            } else {
                Some(bookmarks.add_category(&category)?)
            };
            let bookmark = Bookmark {
                id: id.unwrap_or_else(Uuid::new_v4),
                url: address,
                title,
                category,
            };
            if let Some(id) = id {
                let saved = bookmarks
                    .items
                    .iter_mut()
                    .find(|item| item.id == id)
                    .ok_or("Bookmark no longer exists")?;
                *saved = bookmark;
            } else {
                bookmarks.items.insert(0, bookmark);
            }
            Ok(())
        })?;
    Ok(state.bookmarks)
}

#[tauri::command]
pub(crate) fn remove_bookmark(
    store: State<'_, Mutex<Store>>,
    id: Uuid,
) -> Result<BookmarkData, String> {
    let state = store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            data.bookmarks.items.retain(|bookmark| bookmark.id != id);
            Ok(())
        })?;
    Ok(state.bookmarks)
}

#[tauri::command]
pub(crate) fn rename_bookmark_category(
    store: State<'_, Mutex<Store>>,
    previous: Option<String>,
    name: String,
) -> Result<BookmarkData, String> {
    let name = category_name(&name)?;
    let state = store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            let bookmarks = &mut data.bookmarks;
            let Some(previous) = previous else {
                bookmarks.add_category(name)?;
                return Ok(());
            };

            let index = bookmarks
                .categories
                .iter()
                .position(|category| category == &previous)
                .ok_or("Category no longer exists")?;
            let existing = bookmarks
                .find_category(name)
                .filter(|category| *category != previous.as_str())
                .map(str::to_owned);
            let name = if let Some(existing) = existing {
                bookmarks.categories.remove(index);
                existing
            } else {
                bookmarks.categories[index] = name.to_owned();
                name.to_owned()
            };
            for bookmark in &mut bookmarks.items {
                if bookmark.category.as_deref() == Some(previous.as_str()) {
                    bookmark.category = Some(name.clone());
                }
            }
            Ok(())
        })?;
    Ok(state.bookmarks)
}

#[tauri::command]
pub(crate) fn remove_bookmark_category(
    store: State<'_, Mutex<Store>>,
    name: String,
) -> Result<BookmarkData, String> {
    let state = store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            data.bookmarks
                .categories
                .retain(|category| category != &name);
            for bookmark in &mut data.bookmarks.items {
                if bookmark.category.as_deref() == Some(name.as_str()) {
                    bookmark.category = None;
                }
            }
            Ok(())
        })?;
    Ok(state.bookmarks)
}

#[tauri::command]
pub(crate) fn open_bookmark(store: State<'_, Mutex<Store>>, id: Uuid) -> Result<(), String> {
    let url = {
        let store = store.lock().map_err(|_| "Storage unavailable")?;
        let bookmark = store
            .data
            .bookmarks
            .items
            .iter()
            .find(|item| item.id == id)
            .ok_or("Bookmark no longer exists")?;
        web_url(&bookmark.url)?
    };
    open_in_default_browser(url)
}

#[cfg(windows)]
fn open_in_default_browser(url: Url) -> Result<(), String> {
    use std::ptr;
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let verb: Vec<u16> = "open".encode_utf16().chain([0]).collect();
    let url: Vec<u16> = url.as_str().encode_utf16().chain([0]).collect();
    let result = unsafe {
        ShellExecuteW(
            ptr::null_mut(),
            verb.as_ptr(),
            url.as_ptr(),
            ptr::null(),
            ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    if result as isize > 32 {
        Ok(())
    } else {
        Err("Could not open the link in the default browser".into())
    }
}

#[cfg(not(windows))]
fn open_in_default_browser(url: Url) -> Result<(), String> {
    let binary = if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    let mut child = std::process::Command::new(binary)
        .arg(url.as_str())
        .spawn()
        .map_err(|_| "Could not open the link in the default browser")?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bookmark_addresses_only_open_http_and_https() {
        assert_eq!(
            web_url(" <example.com/path> ").unwrap().as_str(),
            "https://example.com/path"
        );
        for input in [
            "file:///c:/x",
            "javascript:alert(1)",
            "ftp://example.com",
            "//example.com",
            "https://trusted.example@other.example",
            "https://exa mple.com",
            "https://example.com\\bad",
        ] {
            assert!(web_url(input).is_err(), "{input}");
        }
        assert_eq!(
            web_url("https://EXAMPLE.COM/AbC").unwrap().as_str(),
            "https://example.com/AbC"
        );
    }
}
