use crate::drop_actions::persist_unique_file;
use image::{
    codecs::{
        jpeg::JpegEncoder,
        png::{CompressionType, FilterType, PngEncoder},
    },
    imageops::FilterType as ResizeFilter,
    DynamicImage, GenericImageView, ImageDecoder, ImageFormat, ImageReader, Limits,
};
use serde::{Deserialize, Serialize};
use std::{
    ffi::OsStr,
    io::Write,
    path::{Path, PathBuf},
};

const MAX_INPUT_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Quality {
    Light,
    #[default]
    Medium,
    Strong,
}

impl Quality {
    pub(super) fn photo(self) -> (u32, u8) {
        match self {
            Self::Light => (2400, 86),
            Self::Medium => (1600, 74),
            Self::Strong => (1024, 58),
        }
    }

    #[cfg(any(windows, test))]
    pub(super) fn video(self) -> (u32, u32, u32) {
        match self {
            Self::Light => (1920, 6_000_000, 128_000),
            Self::Medium => (1280, 3_000_000, 96_000),
            Self::Strong => (854, 1_500_000, 80_000),
        }
    }
}

pub(super) fn decode(path: &Path) -> Result<(DynamicImage, ImageFormat), String> {
    if path.metadata().map_err(|error| error.to_string())?.len() > MAX_INPUT_BYTES {
        return Err("Choose an image file no larger than 64 MB".into());
    }
    let mut reader = ImageReader::open(path)
        .and_then(ImageReader::with_guessed_format)
        .map_err(|error| error.to_string())?;
    let format = reader.format().ok_or("Unrecognized image format")?;
    if !matches!(
        format,
        ImageFormat::Jpeg
            | ImageFormat::Png
            | ImageFormat::WebP
            | ImageFormat::Bmp
            | ImageFormat::Tiff
    ) {
        return Err("Choose a PNG, JPEG, WebP, BMP or TIFF image".into());
    }
    let mut limits = Limits::default();
    limits.max_image_width = Some(16_384);
    limits.max_image_height = Some(16_384);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(|error| error.to_string())?;
    if decoder.total_bytes() > 128 * 1024 * 1024 {
        return Err("The decoded image is larger than 128 MB".into());
    }
    let orientation = decoder.orientation().map_err(|error| error.to_string())?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(|error| error.to_string())?;
    image.apply_orientation(orientation);
    Ok((image, format))
}

pub(super) fn jpg_pixels(source: DynamicImage) -> image::RgbImage {
    if !source.color().has_alpha() {
        return source.into_rgb8();
    }
    let rgba = source.into_rgba8();
    image::RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let [r, g, b, alpha] = rgba.get_pixel(x, y).0;
        let alpha = u32::from(alpha);
        let composite =
            |value: u8| ((u32::from(value) * alpha + 255 * (255 - alpha) + 127) / 255) as u8;
        image::Rgb([composite(r), composite(g), composite(b)])
    })
}

fn stage_image(
    parent: &Path,
    image: DynamicImage,
    format: ImageFormat,
    quality: u8,
) -> Result<tempfile::NamedTempFile, String> {
    let mut staged = tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    if format == ImageFormat::Jpeg {
        let pixels = jpg_pixels(image);
        JpegEncoder::new_with_quality(&mut staged, quality)
            .encode_image(&pixels)
            .map_err(|error| error.to_string())?;
    } else {
        let image = if image.color().has_alpha() {
            DynamicImage::ImageRgba8(image.into_rgba8())
        } else {
            DynamicImage::ImageRgb8(image.into_rgb8())
        };
        image
            .write_with_encoder(PngEncoder::new_with_quality(
                &mut staged,
                CompressionType::Best,
                FilterType::Adaptive,
            ))
            .map_err(|error| error.to_string())?;
    }
    staged
        .flush()
        .and_then(|()| staged.as_file().sync_all())
        .map_err(|error| error.to_string())?;
    Ok(staged)
}

fn output_location<'path>(
    path: &'path Path,
    suffix: &str,
    format: ImageFormat,
) -> Result<(&'path Path, std::ffi::OsString), String> {
    let parent = path.parent().ok_or("Could not find the image's folder")?;
    let mut name = path
        .file_stem()
        .unwrap_or_else(|| OsStr::new("Image"))
        .to_owned();
    name.push(suffix);
    name.push(if format == ImageFormat::Jpeg {
        ".jpg"
    } else {
        ".png"
    });
    Ok((parent, name))
}

pub(super) fn convert(paths: &[PathBuf]) -> Result<Vec<PathBuf>, String> {
    if paths.iter().any(|path| {
        !path.extension().and_then(OsStr::to_str).is_some_and(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "jfif"
            )
        })
    }) {
        return Err("Drop PNG or JPEG files to convert them".into());
    }
    paths
        .iter()
        .map(|path| {
            let (image, input) = decode(path)?;
            let format = match input {
                ImageFormat::Jpeg => ImageFormat::Png,
                ImageFormat::Png => ImageFormat::Jpeg,
                _ => return Err("Drop PNG or JPEG files to convert them".into()),
            };
            let (parent, name) = output_location(path, "", format)?;
            persist_unique_file(parent, &name, stage_image(parent, image, format, 92)?)
        })
        .collect()
}

pub(super) fn shrink(paths: &[PathBuf], quality: Quality) -> Result<Vec<PathBuf>, String> {
    let (max_side, jpeg_quality) = quality.photo();
    let mut outputs = Vec::new();
    for path in paths {
        let original_size = path.metadata().map_err(|error| error.to_string())?.len();
        let (mut image, _) = decode(path)?;
        if image.width().max(image.height()) > max_side {
            image = image.resize(max_side, max_side, ResizeFilter::Lanczos3);
        }
        let format =
            if image.color().has_alpha() && image.pixels().any(|(_, _, pixel)| pixel[3] != 255) {
                ImageFormat::Png
            } else {
                ImageFormat::Jpeg
            };
        let (parent, name) = output_location(path, " (smaller)", format)?;
        let staged = stage_image(parent, image, format, jpeg_quality)?;
        if staged
            .as_file()
            .metadata()
            .map_err(|error| error.to_string())?
            .len()
            < original_size
        {
            outputs.push(persist_unique_file(parent, &name, staged)?);
        }
    }
    Ok(outputs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_both_directions_without_overwriting_and_flattens_jpeg_alpha() {
        let directory = tempfile::tempdir().unwrap();
        let image = directory.path().join("photo.png");
        DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            18,
            18,
            image::Rgba([255, 0, 0, 0]),
        ))
        .save(&image)
        .unwrap();
        let original = std::fs::read(&image).unwrap();
        let first = convert(std::slice::from_ref(&image)).unwrap().remove(0);
        let second = convert(std::slice::from_ref(&image)).unwrap().remove(0);
        assert_ne!(first, second);
        assert!(image::open(&first)
            .unwrap()
            .to_rgb8()
            .pixels()
            .all(|pixel| pixel.0.iter().all(|&value| value >= 250)));
        let back = convert(&[first]).unwrap().remove(0);
        assert_eq!(back.extension().unwrap(), "png");
        assert_eq!(std::fs::read(image).unwrap(), original);
    }

    #[test]
    fn strong_quality_shrinks_a_photo_and_keeps_original() {
        let directory = tempfile::tempdir().unwrap();
        let input = directory.path().join("example.bmp");
        image::RgbImage::from_pixel(1200, 40, image::Rgb([90, 110, 200]))
            .save(&input)
            .unwrap();
        let output = shrink(std::slice::from_ref(&input), Quality::Strong)
            .unwrap()
            .remove(0);
        assert!(output.metadata().unwrap().len() < input.metadata().unwrap().len());
        assert_eq!(image::open(output).unwrap().width(), 1024);
        assert_eq!(image::open(input).unwrap().width(), 1200);
    }
}
