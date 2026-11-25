use crate::{drop_images, drop_ocr, drop_pdf, drop_share, drop_windows, shelf, Store};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    ffi::OsStr,
    fs::{self, File},
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use tauri::{Manager, WebviewWindow};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

const MAX_ENTRIES: usize = 50_000;
const MAX_DEPTH: usize = 64;
const MAX_EXTRACT_BYTES: u64 = 8 * 1024 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Tile {
    Shelf,
    Share,
    Zip,
    Extract,
    Copy,
    ShrinkPdf,
    ShrinkImage,
    Convert,
    Ocr,
    Move,
    Onedrive,
    OpenWith,
    Recycle,
}

impl Tile {
    pub(super) const ALL: [Self; 13] = [
        Self::Shelf,
        Self::Share,
        Self::Zip,
        Self::ShrinkPdf,
        Self::ShrinkImage,
        Self::Extract,
        Self::Convert,
        Self::Ocr,
        Self::Copy,
        Self::Move,
        Self::Onedrive,
        Self::OpenWith,
        Self::Recycle,
    ];
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub(super) enum Outcome {
    Saved { paths: Vec<PathBuf> },
    Moved { count: usize },
    Recycled { count: usize },
    Opened,
    Cancelled,
    AlreadySmall,
    TextCopied { preview: String },
    NoText,
}

fn saved(paths: Vec<PathBuf>) -> Outcome {
    Outcome::Saved { paths }
}

fn alternate(name: &OsStr, number: u16) -> std::ffi::OsString {
    if number == 0 {
        return name.to_owned();
    }
    let path = Path::new(name);
    let mut result = path.file_stem().unwrap_or(name).to_owned();
    result.push(format!(" ({number})"));
    if let Some(extension) = path.extension() {
        result.push(".");
        result.push(extension);
    }
    result
}

fn publish_directory(staged: &Path, parent: &Path, name: &OsStr) -> Result<PathBuf, String> {
    for index in 0..1000 {
        let path = parent.join(alternate(name, index));
        match rename_new_directory(staged, &path) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("Could not choose a unique directory name".into())
}

#[cfg(windows)]
fn rename_new_directory(from: &Path, to: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::MoveFileW;
    let old: Vec<u16> = from
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let new: Vec<u16> = to
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    if unsafe { MoveFileW(old.as_ptr(), new.as_ptr()) } != 0 {
        Ok(())
    } else {
        let error = io::Error::last_os_error();
        if to.exists() {
            Err(io::Error::from(io::ErrorKind::AlreadyExists))
        } else {
            Err(error)
        }
    }
}

#[cfg(not(windows))]
fn rename_new_directory(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir(to)?;
    for child in fs::read_dir(from)? {
        let child = child?;
        fs::rename(child.path(), to.join(child.file_name()))?;
    }
    Ok(())
}

pub(super) fn persist_unique_file(
    parent: &Path,
    name: &OsStr,
    mut temp: tempfile::NamedTempFile,
) -> Result<PathBuf, String> {
    for index in 0..1000 {
        let path = parent.join(alternate(name, index));
        match temp.persist_noclobber(&path) {
            Ok(_) => return Ok(path),
            Err(error) if error.error.kind() == io::ErrorKind::AlreadyExists => temp = error.file,
            Err(error) => return Err(error.error.to_string()),
        }
    }
    Err("Could not choose a unique archive name".into())
}

fn walk_entries(
    path: &Path,
    relative: &Path,
    depth: usize,
    remaining: &mut usize,
    visit: &mut impl FnMut(&Path, &Path, bool) -> Result<(), String>,
) -> Result<(), String> {
    if depth >= MAX_DEPTH || *remaining == 0 {
        return Err("Too many files or nested folders".into());
    }
    *remaining -= 1;
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(format!(
                "Cannot include a linked folder or file: {}",
                path.display()
            ));
        }
    }
    if !metadata.is_dir() && !metadata.is_file() {
        return Err(format!(
            "Cannot include a special file or link: {}",
            path.display()
        ));
    }
    visit(path, relative, metadata.is_dir())?;
    if metadata.is_dir() {
        for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            walk_entries(
                &entry.path(),
                &relative.join(entry.file_name()),
                depth + 1,
                remaining,
                visit,
            )?;
        }
    }
    Ok(())
}

fn make_zip(paths: &[PathBuf]) -> Result<PathBuf, String> {
    let first = paths.first().ok_or("Choose at least one file or folder")?;
    let parent = first
        .parent()
        .ok_or("Select a file or folder below the drive root")?;
    let name = if paths.len() == 1 {
        let mut stem = first
            .file_stem()
            .unwrap_or_else(|| OsStr::new("Archive"))
            .to_owned();
        stem.push(".zip");
        stem
    } else {
        "Archive.zip".into()
    };
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    let mut remaining = MAX_ENTRIES;
    let mut roots = HashSet::new();
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    {
        let mut archive = ZipWriter::new(&mut temp);
        for path in paths {
            let base = path
                .file_name()
                .ok_or("Select files or folders below the drive root")?;
            let root = (0..1000)
                .map(|index| alternate(base, index))
                .find(|name| roots.insert(name.to_string_lossy().to_lowercase()))
                .ok_or("Too many files with the same name")?;
            walk_entries(
                path,
                Path::new(&root),
                0,
                &mut remaining,
                &mut |source, relative, directory| {
                    let stored = relative
                        .iter()
                        .map(OsStr::to_string_lossy)
                        .collect::<Vec<_>>()
                        .join("/");
                    if directory {
                        archive
                            .add_directory(stored, options)
                            .map_err(|error| error.to_string())
                    } else {
                        archive
                            .start_file(stored, options)
                            .map_err(|error| error.to_string())?;
                        let mut input = File::open(source).map_err(|error| error.to_string())?;
                        io::copy(&mut input, &mut archive).map_err(|error| error.to_string())?;
                        Ok(())
                    }
                },
            )?;
        }
        archive.finish().map_err(|error| error.to_string())?;
    }
    temp.flush()
        .and_then(|()| temp.as_file().sync_all())
        .map_err(|error| error.to_string())?;
    persist_unique_file(parent, &name, temp)
}

fn safe_archive_path(name: &str, path: Option<PathBuf>) -> Result<PathBuf, String> {
    if name.contains(['\\', ':']) {
        return Err("An archive entry has an unsupported path".into());
    }
    let path = path.ok_or("An archive entry would write outside the destination")?;
    if path.as_os_str().is_empty()
        || !path.components().all(|part| {
            let Component::Normal(part) = part else {
                return false;
            };
            let Some(part) = part.to_str() else {
                return false;
            };
            if part.ends_with(['.', ' ']) || part.chars().any(char::is_control) {
                return false;
            }
            let stem = part
                .split('.')
                .next()
                .unwrap_or(part)
                .trim_end()
                .to_ascii_uppercase();
            !matches!(
                stem.as_str(),
                "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
            ) && !(stem
                .strip_prefix("COM")
                .or_else(|| stem.strip_prefix("LPT"))
                .is_some_and(|suffix| {
                    matches!(
                        suffix,
                        "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                    )
                }))
        })
    {
        return Err("An archive entry would write outside the destination".into());
    }
    Ok(path)
}

fn check_archive_entry(entry: &zip::read::ZipFile<'_, File>) -> Result<PathBuf, String> {
    if entry
        .unix_mode()
        .is_some_and(|mode| !matches!(mode & 0o170000, 0 | 0o040000 | 0o100000))
    {
        return Err("The ZIP contains a link or special file".into());
    }
    safe_archive_path(entry.name(), entry.enclosed_name())
}

fn extract_zip(path: &Path) -> Result<PathBuf, String> {
    let input = File::open(path).map_err(|error| error.to_string())?;
    let mut archive =
        ZipArchive::new(input).map_err(|error| format!("Could not read ZIP: {error}"))?;
    if archive.len() > MAX_ENTRIES {
        return Err("The ZIP has too many entries".into());
    }
    let mut total = 0u64;
    let mut names = HashSet::new();
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|error| error.to_string())?;
        let name = check_archive_entry(&entry)?;
        if !names.insert(name.to_string_lossy().to_lowercase()) {
            return Err("The ZIP contains duplicate paths".into());
        }
        total = total.saturating_add(entry.size());
        if total > MAX_EXTRACT_BYTES {
            return Err("The ZIP would extract more than 8 GB".into());
        }
    }
    let parent = path.parent().ok_or("Could not find the ZIP's folder")?;
    let stage = tempfile::tempdir_in(parent).map_err(|error| error.to_string())?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        let output = stage.path().join(check_archive_entry(&entry)?);
        if entry.is_dir() {
            fs::create_dir_all(output).map_err(|error| error.to_string())?;
        } else {
            if let Some(parent) = output.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            let declared = entry.size();
            let mut file = File::create_new(output).map_err(|error| error.to_string())?;
            let count = io::copy(
                &mut entry.by_ref().take(declared.saturating_add(1)),
                &mut file,
            )
            .map_err(|error| error.to_string())?;
            if count != declared {
                return Err("The ZIP entry size did not match".into());
            }
        }
    }
    let name = path.file_stem().unwrap_or_else(|| OsStr::new("Extracted"));
    publish_directory(stage.path(), parent, name)
}

fn copy_to(paths: &[PathBuf], destination: &Path) -> Result<Vec<PathBuf>, String> {
    let mut outputs = Vec::new();
    let mut remaining = MAX_ENTRIES;
    for path in paths {
        let name = path
            .file_name()
            .ok_or("Select files or folders below the drive root")?;
        if path.is_dir() {
            if destination.starts_with(path) {
                return Err("A folder cannot be copied inside itself".into());
            }
            let stage = tempfile::tempdir_in(destination).map_err(|error| error.to_string())?;
            walk_entries(
                path,
                Path::new(""),
                0,
                &mut remaining,
                &mut |source, relative, directory| {
                    let target = stage.path().join(relative);
                    if directory {
                        fs::create_dir_all(target).map_err(|error| error.to_string())
                    } else {
                        fs::copy(source, target)
                            .map(|_| ())
                            .map_err(|error| error.to_string())
                    }
                },
            )?;
            let output = publish_directory(stage.path(), destination, name)?;
            outputs.push(output);
        } else {
            let mut temp =
                tempfile::NamedTempFile::new_in(destination).map_err(|error| error.to_string())?;
            io::copy(
                &mut File::open(path).map_err(|error| error.to_string())?,
                &mut temp,
            )
            .map_err(|error| error.to_string())?;
            outputs.push(persist_unique_file(destination, name, temp)?);
        }
    }
    Ok(outputs)
}

fn copy_to_onedrive(paths: &[PathBuf], root: &Path) -> Result<Vec<PathBuf>, String> {
    let root = dunce::canonicalize(root).map_err(|error| error.to_string())?;
    let destination = root.join("Poni");
    for path in paths {
        if path.is_dir() && destination.starts_with(path) {
            return Err("Choose a folder outside the Poni copy destination".into());
        }
    }
    fs::create_dir_all(&destination).map_err(|error| error.to_string())?;
    let resolved = dunce::canonicalize(&destination).map_err(|error| error.to_string())?;
    if resolved == root || !resolved.starts_with(&root) {
        return Err("The Poni folder is outside the configured OneDrive folder".into());
    }
    copy_to(paths, &resolved)
}

fn onedrive_root() -> Result<PathBuf, String> {
    ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]
        .into_iter()
        .filter_map(std::env::var_os)
        .map(PathBuf::from)
        .find(|path| path.is_absolute() && path.is_dir())
        .ok_or_else(|| "Set up a synced OneDrive folder in Windows first".into())
}

fn checked_source(action: Tile, path: PathBuf) -> Result<PathBuf, String> {
    if matches!(action, Tile::Move | Tile::Recycle) && path.is_absolute() {
        let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        #[cfg(windows)]
        let is_linked = {
            use std::os::windows::fs::MetadataExt;
            use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
            metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
        };
        #[cfg(not(windows))]
        let is_linked = metadata.is_symlink();
        if is_linked {
            return Err("Choose the original file or folder in Explorer".into());
        }
    }
    shelf::checked_path(path)
}

#[tauri::command]
pub(super) async fn run_drop_action(
    window: WebviewWindow,
    action: Tile,
    paths: Vec<PathBuf>,
) -> Result<Outcome, String> {
    if paths.is_empty() || paths.len() > 200 {
        return Err("Drop between 1 and 200 files or folders".into());
    }
    let app = window.app_handle();
    let store = app.state::<Mutex<Store>>();
    let quality = {
        let store = store.lock().map_err(|_| "Storage unavailable")?;
        let preferences = &store.data.settings.shelf;
        if !preferences.drop_enabled || !preferences.tiles.contains(&action) {
            return Err("This drop action is turned off".into());
        }
        preferences.quality
    };
    let folder = if matches!(action, Tile::Copy | Tile::Move) {
        #[cfg(windows)]
        {
            let selected = rfd::AsyncFileDialog::new()
                .set_parent(&window)
                .pick_folder()
                .await;
            let Some(selected) = selected else {
                return Ok(Outcome::Cancelled);
            };
            Some(selected.path().to_owned())
        }
        #[cfg(not(windows))]
        return Err("The folder picker is available on Windows".into());
    } else {
        None
    };
    let owner = drop_windows::owner(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let paths = paths
            .into_iter()
            .map(|path| checked_source(action, path))
            .collect::<Result<Vec<_>, _>>()?;
        match action {
            Tile::Share => drop_share::show(&window, owner, &paths).map(|()| Outcome::Opened),
            Tile::Zip => make_zip(&paths).map(|output| saved(vec![output])),
            Tile::ShrinkImage | Tile::ShrinkPdf => {
                let paths = match action {
                    Tile::ShrinkImage => drop_images::shrink(&paths, quality)?,
                    _ => drop_pdf::shrink(&paths, quality)?,
                };
                if paths.is_empty() {
                    Ok(Outcome::AlreadySmall)
                } else {
                    Ok(saved(paths))
                }
            }
            Tile::Convert => drop_images::convert(&paths).map(saved),
            Tile::Ocr => drop_ocr::copy_recognized_text(&paths),
            Tile::Extract => {
                if !paths.iter().all(|path| {
                    path.extension()
                        .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
                }) {
                    return Err("Drop ZIP files to extract them".into());
                }
                paths
                    .iter()
                    .map(|path| extract_zip(path))
                    .collect::<Result<Vec<_>, _>>()
                    .map(saved)
            }
            Tile::Copy => copy_to(
                &paths,
                &shelf::checked_path(folder.ok_or("No destination chosen")?)?,
            )
            .map(saved),
            Tile::Move => drop_windows::move_items(
                owner,
                &paths,
                &shelf::checked_path(folder.ok_or("No destination chosen")?)?,
            ),
            Tile::Onedrive => copy_to_onedrive(&paths, &onedrive_root()?).map(saved),
            Tile::OpenWith => drop_windows::open_with(owner, &paths),
            Tile::Recycle => drop_windows::recycle(owner, &paths),
            Tile::Shelf => Err("Drop files on the Shelf to keep their references".into()),
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zip_copy_and_extract_preserve_originals_and_avoid_overwrites() {
        let staging = tempfile::tempdir().unwrap();
        let source = staging.path().join("Documents");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("notes.txt"), b"from Poni").unwrap();
        let first = make_zip(std::slice::from_ref(&source)).unwrap();
        let second = make_zip(std::slice::from_ref(&source)).unwrap();
        assert_ne!(first, second);
        let extracted = extract_zip(&first).unwrap();
        assert_eq!(
            fs::read(extracted.join("Documents/notes.txt")).unwrap(),
            b"from Poni"
        );
        let copies = copy_to(&[source.clone()], staging.path()).unwrap();
        assert_ne!(copies[0], source);
        assert_eq!(fs::read(source.join("notes.txt")).unwrap(), b"from Poni");
    }

    #[test]
    fn archive_paths_are_relative_normal_components() {
        assert!(safe_archive_path("pictures/a.png", Some("pictures/a.png".into())).is_ok());
        assert!(safe_archive_path("/absolute.txt", None).is_err());
        assert!(
            safe_archive_path("child.txt:alternate", Some("child.txt:alternate".into())).is_err()
        );
    }

    #[test]
    fn onedrive_copies_into_poni_and_preserves_both_originals_and_collisions() {
        let stage = tempfile::tempdir().unwrap();
        let source = stage.path().join("example.txt");
        let root = stage.path().join("sync");
        fs::create_dir(&root).unwrap();
        fs::write(&source, "sample").unwrap();
        let first = copy_to_onedrive(std::slice::from_ref(&source), &root).unwrap();
        let second = copy_to_onedrive(std::slice::from_ref(&source), &root).unwrap();
        let destination = dunce::canonicalize(root.join("Poni")).unwrap();
        assert_eq!(first[0].parent().unwrap(), destination);
        assert_eq!(second[0].parent().unwrap(), destination);
        assert_ne!(first, second);
        assert_eq!(fs::read_to_string(&first[0]).unwrap(), "sample");
        assert_eq!(fs::read_to_string(&second[0]).unwrap(), "sample");
        assert_eq!(fs::read_to_string(source).unwrap(), "sample");
    }
}
