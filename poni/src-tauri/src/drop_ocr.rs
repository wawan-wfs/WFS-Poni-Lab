use crate::drop_actions::Outcome;
use std::path::PathBuf;

#[cfg(not(windows))]
pub(super) fn copy_recognized_text(_paths: &[PathBuf]) -> Result<Outcome, String> {
    Err("Text recognition is available on Windows".into())
}

#[cfg(windows)]
pub(super) fn copy_recognized_text(paths: &[PathBuf]) -> Result<Outcome, String> {
    std::thread::scope(|scope| {
        scope
            .spawn(|| read_and_copy(paths))
            .join()
            .map_err(|_| "Text recognition stopped".to_string())?
    })
}

#[cfg(windows)]
fn read_and_copy(paths: &[PathBuf]) -> Result<Outcome, String> {
    use crate::{drop_images, shelf};
    use windows::{
        Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap},
        Media::Ocr::OcrEngine,
        Security::Cryptography::CryptographicBuffer,
        Win32::{
            Foundation::E_POINTER,
            System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
        },
    };

    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe { RoUninitialize() };
        }
    }
    unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.map_err(|error| error.to_string())?;
    let _apartment = Apartment;
    let engine = OcrEngine::TryCreateFromUserProfileLanguages().map_err(|error| {
        if error.code() == E_POINTER {
            "Add a text recognition language in Windows Settings".into()
        } else {
            error.to_string()
        }
    })?;
    let limit = OcrEngine::MaxImageDimension().map_err(|error| error.to_string())?;
    let mut text = Vec::new();
    for path in paths {
        let (mut image, _) = drop_images::decode(path)?;
        if image.width().max(image.height()) > limit {
            image = image.resize(limit, limit, image::imageops::FilterType::Lanczos3);
        }
        let rgb = drop_images::jpg_pixels(image);
        let (width, height) = rgb.dimensions();
        let bgra: Vec<u8> = rgb
            .pixels()
            .flat_map(|pixel| {
                let [r, g, b] = pixel.0;
                [b, g, r, 255]
            })
            .collect();
        let buffer =
            CryptographicBuffer::CreateFromByteArray(&bgra).map_err(|error| error.to_string())?;
        let bitmap = SoftwareBitmap::CreateCopyFromBuffer(
            &buffer,
            BitmapPixelFormat::Bgra8,
            width as i32,
            height as i32,
        )
        .map_err(|error| error.to_string())?;
        let result = engine
            .RecognizeAsync(&bitmap)
            .and_then(|operation| operation.get())
            .and_then(|result| result.Text())
            .map_err(|error| format!("Could not read the text in {}: {error}", path.display()))?;
        let recognized = result.to_string_lossy();
        if !recognized.trim().is_empty() {
            text.push(recognized);
        }
    }
    if text.is_empty() {
        return Ok(Outcome::NoText);
    }
    let text = text.join("\n\n");
    shelf::copy_to_clipboard(&text)?;
    let summary = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut chars = summary.chars();
    let mut preview: String = chars.by_ref().take(80).collect();
    if chars.next().is_some() {
        preview.push('…');
    }
    Ok(Outcome::TextCopied { preview })
}
