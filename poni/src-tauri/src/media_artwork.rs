use serde::Serialize;

#[derive(Serialize)]
pub(super) struct Cover {
    jpeg: String,
    accent: Option<String>,
}

#[cfg(windows)]
pub(super) fn read(
    properties: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
) -> Option<Cover> {
    use windows::Storage::Streams::DataReader;
    let view = properties
        .Thumbnail()
        .ok()?
        .OpenReadAsync()
        .ok()?
        .get()
        .ok()?;
    let length = view.Size().ok()?;
    if !(1..=2_097_152).contains(&length) {
        return None;
    }
    let input = view.GetInputStreamAt(0).ok()?;
    let reader = DataReader::CreateDataReader(&input).ok()?;
    if reader.LoadAsync(length as u32).ok()?.get().ok()? as u64 != length {
        return None;
    }
    let mut bytes = vec![0; length as usize];
    reader.ReadBytes(&mut bytes).ok()?;
    encode(&bytes)
}

#[cfg(any(windows, test))]
fn encode(bytes: &[u8]) -> Option<Cover> {
    use base64::Engine;
    use image::{
        codecs::jpeg::JpegEncoder, imageops::FilterType, ImageDecoder, ImageReader, Limits,
    };
    let mut reader = ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .ok()?;
    let mut limits = Limits::default();
    limits.max_image_width = Some(4096);
    limits.max_image_height = Some(4096);
    limits.max_alloc = Some(40 * 1024 * 1024);
    reader.limits(limits);
    let decoder = reader.into_decoder().ok()?;
    if decoder.total_bytes() > 40 * 1024 * 1024 {
        return None;
    }
    let art = image::DynamicImage::from_decoder(decoder)
        .ok()?
        .resize(160, 160, FilterType::Triangle)
        .into_rgb8();
    let mut totals = [0u64; 3];
    let mut weight_sum = 0u64;
    for &image::Rgb([r, g, b]) in art.pixels() {
        let high = r.max(g).max(b);
        let low = r.min(g).min(b);
        if high < 48 || high - low < 18 {
            continue;
        }
        let weight = u64::from(high - low);
        for (total, channel) in totals.iter_mut().zip([r, g, b]) {
            *total += u64::from(channel) * weight;
        }
        weight_sum += weight;
    }
    let accent = (weight_sum > 0).then(|| {
        let [r, g, b] = totals.map(|value| value / weight_sum);
        format!("#{r:02x}{g:02x}{b:02x}")
    });
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, 82)
        .encode(
            &art,
            art.width(),
            art.height(),
            image::ExtendedColorType::Rgb8,
        )
        .ok()?;
    Some(Cover {
        jpeg: base64::engine::general_purpose::STANDARD.encode(jpeg),
        accent,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use image::ImageEncoder;

    #[test]
    fn bounds_album_art_and_extracts_a_color_without_using_a_service() {
        let portrait = image::RgbImage::from_pixel(480, 240, image::Rgb([205, 45, 30]));
        let mut source = Vec::new();
        image::codecs::png::PngEncoder::new(&mut source)
            .write_image(&portrait, 480, 240, image::ExtendedColorType::Rgb8)
            .unwrap();
        let art = encode(&source).unwrap();
        let jpeg = base64::engine::general_purpose::STANDARD
            .decode(art.jpeg)
            .unwrap();
        let result = image::load_from_memory(&jpeg).unwrap();
        assert_eq!((result.width(), result.height()), (160, 80));
        assert_eq!(art.accent.as_deref(), Some("#cd2d1e"));
        assert!(encode(b"not an image").is_none());
    }
}
