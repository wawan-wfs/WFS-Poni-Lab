use crate::{drop_actions::persist_unique_file, drop_images::Quality};
use image::{
    codecs::jpeg::JpegEncoder, DynamicImage, ImageDecoder, ImageFormat, ImageReader, Limits,
};
use lopdf::{Document, LoadOptions, Object, Stream};
use std::{
    collections::HashSet,
    ffi::OsStr,
    fs::File,
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
};

const MAX_PDF_BYTES: u64 = 128 * 1024 * 1024;
const MAX_IMAGE_BYTES: usize = 64 * 1024 * 1024;
const MAX_DIMENSION: u32 = 16_384;

pub(super) fn shrink(paths: &[PathBuf], quality: Quality) -> Result<Vec<PathBuf>, String> {
    if !paths.iter().all(|path| {
        path.is_file()
            && path
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"))
    }) {
        return Err("Drop PDF files to shrink their pictures".into());
    }
    let mut outputs = Vec::new();
    for path in paths {
        if let Some(output) =
            shrink_pdf(path, quality).map_err(|error| format!("{}: {error}", path.display()))?
        {
            outputs.push(output);
        }
    }
    Ok(outputs)
}

fn shrink_pdf(path: &Path, quality: Quality) -> Result<Option<PathBuf>, String> {
    let mut input = Vec::new();
    File::open(path)
        .and_then(|file| file.take(MAX_PDF_BYTES + 1).read_to_end(&mut input))
        .map_err(|error| error.to_string())?;
    if input.len() as u64 > MAX_PDF_BYTES {
        return Err("Choose a PDF no larger than 128 MB".into());
    }
    let options = LoadOptions {
        strict: true,
        max_decompressed_size: Some(MAX_IMAGE_BYTES),
        ..LoadOptions::default()
    };
    let mut pdf = Document::load_mem_with_options(&input, options)
        .map_err(|error| format!("Could not read the PDF: {error}"))?;
    let original_size = input.len() as u64;
    drop(input);
    if pdf.is_encrypted() || pdf.was_encrypted() || pdf.objects.values().any(has_signature) {
        return Err("Choose a PDF without encryption or a digital signature".into());
    }
    if pdf.get_pages().is_empty() {
        return Err("Could not find any pages in the PDF".into());
    }
    let masks: HashSet<_> = pdf
        .objects
        .values()
        .filter_map(|object| object.as_stream().ok())
        .flat_map(|stream| {
            [b"Mask".as_slice(), b"SMask"]
                .into_iter()
                .filter_map(|key| stream.dict.get(key).and_then(Object::as_reference).ok())
        })
        .collect();
    let mut changed = false;
    for (id, object) in &mut pdf.objects {
        if let Ok(stream) = object.as_stream_mut() {
            if !masks.contains(id) {
                changed |= shrink_picture(stream, quality);
            }
        }
    }
    if !changed {
        return Ok(None);
    }
    let parent = path.parent().ok_or("Could not find the PDF's folder")?;
    let mut name = path
        .file_stem()
        .unwrap_or_else(|| OsStr::new("Document"))
        .to_owned();
    name.push(" (smaller).pdf");
    let mut staged = tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    pdf.save_to(&mut staged)
        .map_err(|error| error.to_string())?;
    staged.flush().map_err(|error| error.to_string())?;
    if staged
        .as_file()
        .metadata()
        .map_err(|error| error.to_string())?
        .len()
        >= original_size
    {
        return Ok(None);
    }
    staged
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    persist_unique_file(parent, &name, staged).map(Some)
}

fn has_signature(object: &Object) -> bool {
    match object {
        Object::Dictionary(dict) => {
            dict.has(b"ByteRange")
                || dict
                    .get(b"Type")
                    .and_then(Object::as_name)
                    .is_ok_and(|name| name == b"Sig")
                || dict.iter().any(|(_, value)| has_signature(value))
        }
        Object::Array(items) => items.iter().any(has_signature),
        _ => false,
    }
}

fn shrink_picture(stream: &mut Stream, quality: Quality) -> bool {
    let Some(mut picture) = decode_picture(stream) else {
        return false;
    };
    let (max_side, jpeg_quality) = quality.photo();
    if picture.width().max(picture.height()) > max_side {
        picture = picture.resize(max_side, max_side, image::imageops::FilterType::Lanczos3);
    }
    let mut bytes = Vec::new();
    if JpegEncoder::new_with_quality(&mut bytes, jpeg_quality)
        .encode_image(&picture)
        .is_err()
        || bytes.len() >= stream.content.len()
    {
        return false;
    }
    stream.set_content(bytes);
    stream.dict.set("Width", i64::from(picture.width()));
    stream.dict.set("Height", i64::from(picture.height()));
    stream
        .dict
        .set("Filter", Object::Name(b"DCTDecode".to_vec()));
    stream.dict.remove(b"DecodeParms");
    true
}

fn decode_picture(stream: &Stream) -> Option<DynamicImage> {
    let dict = &stream.dict;
    if dict.get(b"Subtype").ok()?.as_name().ok()? != b"Image"
        || dict.get(b"BitsPerComponent").ok()?.as_i64().ok()? != 8
        || [
            b"ImageMask".as_slice(),
            b"Mask",
            b"SMask",
            b"SMaskInData",
            b"Decode",
            b"Alternates",
            b"F",
        ]
        .into_iter()
        .any(|key| dict.has(key))
    {
        return None;
    }
    let channels = match dict.get(b"ColorSpace").ok()?.as_name().ok()? {
        b"DeviceGray" => 1,
        b"DeviceRGB" => 3,
        _ => return None,
    };
    let dimension = |key| {
        let value = u32::try_from(dict.get(key).ok()?.as_i64().ok()?).ok()?;
        (value > 0 && value <= MAX_DIMENSION).then_some(value)
    };
    let (width, height) = (dimension(b"Width")?, dimension(b"Height")?);
    let expected = (width as usize)
        .checked_mul(height as usize)?
        .checked_mul(channels)?;
    if expected > MAX_IMAGE_BYTES {
        return None;
    }
    let filter = if dict.has(b"Filter") {
        let names = stream.filters().ok()?;
        let [name] = names.as_slice() else {
            return None;
        };
        *name
    } else {
        b""
    };
    let pixels = match filter {
        b"DCTDecode" if !dict.has(b"DecodeParms") => {
            let mut reader =
                ImageReader::with_format(Cursor::new(&stream.content), ImageFormat::Jpeg);
            let mut limits = Limits::default();
            limits.max_image_width = Some(width);
            limits.max_image_height = Some(height);
            limits.max_alloc = Some(MAX_IMAGE_BYTES as u64);
            reader.limits(limits);
            let decoder = reader.into_decoder().ok()?;
            if decoder.dimensions() != (width, height)
                || decoder.total_bytes() > MAX_IMAGE_BYTES as u64
            {
                return None;
            }
            let picture = DynamicImage::from_decoder(decoder).ok()?;
            if channels == 1 {
                picture.into_luma8().into_raw()
            } else {
                picture.into_rgb8().into_raw()
            }
        }
        b"FlateDecode" => stream
            .decompressed_content_with_limit(expected + height as usize)
            .ok()?,
        b"" if stream.content.len() == expected => stream.content.clone(),
        _ => return None,
    };
    if pixels.len() != expected {
        return None;
    }
    if channels == 1 {
        image::GrayImage::from_raw(width, height, pixels).map(DynamicImage::ImageLuma8)
    } else {
        image::RgbImage::from_raw(width, height, pixels).map(DynamicImage::ImageRgb8)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{
        content::{Content, Operation},
        dictionary, ObjectId,
    };
    use std::fs;

    fn fixture(path: &Path, with_picture: bool) -> (ObjectId, ObjectId) {
        let mut pdf = Document::with_version("1.7");
        let pages = pdf.new_object_id();
        let font = pdf.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica",
        });
        let pixels = image::RgbImage::from_fn(1200, 720, |x, y| {
            image::Rgb([(x % 255) as u8, (y % 255) as u8, ((x + y) % 255) as u8])
        })
        .into_raw();
        let picture = pdf.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject", "Subtype" => "Image", "Width" => 1200, "Height" => 720,
                "BitsPerComponent" => 8, "ColorSpace" => "DeviceRGB",
            },
            pixels,
        ));
        let mut operations = vec![
            Operation::new("BT", vec![]),
            Operation::new("Tf", vec!["F1".into(), 14.into()]),
            Operation::new("Tj", vec![Object::string_literal("Editable text")]),
            Operation::new("ET", vec![]),
            Operation::new("re", vec![0.into(), 0.into(), 15.into(), 20.into()]),
            Operation::new("S", vec![]),
        ];
        if with_picture {
            operations.push(Operation::new("Do", vec!["Photo".into()]));
        } else {
            pdf.objects.remove(&picture);
        }
        let content = pdf.add_object(Stream::new(
            dictionary! {},
            Content { operations }.encode().unwrap(),
        ));
        let mut resources = dictionary! { "Font" => dictionary! { "F1" => font } };
        if with_picture {
            resources.set("XObject", dictionary! { "Photo" => picture });
        }
        let page = pdf.add_object(dictionary! {
            "Type" => "Page", "Parent" => pages, "MediaBox" => vec![0.into(), 0.into(), 400.into(), 600.into()],
            "Resources" => resources, "Contents" => content,
        });
        pdf.objects.insert(
            pages,
            dictionary! { "Type" => "Pages", "Kids" => vec![page.into()], "Count" => 1 }.into(),
        );
        let catalog = pdf.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages });
        pdf.trailer.set("Root", catalog);
        pdf.save(path).unwrap();
        (page, picture)
    }

    #[test]
    fn shrinks_pictures_and_preserves_text_graphics_and_the_original_pdf() {
        let folder = tempfile::tempdir().unwrap();
        let original = folder.path().join("source.pdf");
        let (page, picture) = fixture(&original, true);
        let original_bytes = fs::read(&original).unwrap();
        let first = shrink_pdf(&original, Quality::Strong).unwrap().unwrap();
        let second = shrink_pdf(&original, Quality::Strong).unwrap().unwrap();
        let result = Document::load(&first).unwrap();
        let source = Document::load(&original).unwrap();
        let content = source.get_page_content(page);
        assert!(!content.is_empty());
        assert_eq!(result.get_page_content(page), content);
        assert_eq!(source.get_pages(), result.get_pages());
        let stream = result.get_object(picture).unwrap().as_stream().unwrap();
        assert_eq!(stream.dict.get(b"Width").unwrap().as_i64().unwrap(), 1024);
        assert_eq!(stream.filters().unwrap(), [b"DCTDecode"]);
        assert_ne!(first, second);
        assert!(fs::metadata(first).unwrap().len() < original_bytes.len() as u64);
        assert_eq!(fs::read(original).unwrap(), original_bytes);
    }

    #[test]
    fn leaves_a_pdf_with_only_text_and_graphics_unchanged() {
        let folder = tempfile::tempdir().unwrap();
        let original = folder.path().join("source.pdf");
        fixture(&original, false);
        assert!(shrink_pdf(&original, Quality::Medium).unwrap().is_none());
        assert_eq!(fs::read_dir(folder.path()).unwrap().count(), 1);
    }
}
