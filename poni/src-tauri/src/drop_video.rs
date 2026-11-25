use crate::{drop_actions::Outcome, drop_images::Quality};
use std::{
    path::PathBuf,
    sync::atomic::{AtomicU8, Ordering},
};
use tauri::WebviewWindow;

const IDLE: u8 = 0;
const RUNNING: u8 = 1;
const CANCELLING: u8 = 2;

#[derive(Default)]
pub(super) struct VideoJob(AtomicU8);

#[tauri::command]
pub(super) fn cancel_video_shrink(window: WebviewWindow, job: tauri::State<'_, VideoJob>) -> bool {
    window.label() == "main"
        && job
            .0
            .compare_exchange(RUNNING, CANCELLING, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
}

#[cfg(not(windows))]
pub(super) fn shrink(
    _window: &WebviewWindow,
    _paths: &[PathBuf],
    _quality: Quality,
) -> Result<Outcome, String> {
    Err("Video compression is available on Windows".into())
}

#[cfg(windows)]
pub(super) use native::shrink;

#[cfg(any(windows, test))]
fn dimensions(width: u32, height: u32, width_limit: u32) -> Result<(u32, u32), String> {
    if width < 2 || height < 2 {
        return Err("Could not read the video's dimensions".into());
    }
    let scale = (f64::from(width_limit) / f64::from(width))
        .min(4096.0 / f64::from(height))
        .min(1.0);
    let even = |size| ((f64::from(size) * scale).floor() as u32 & !1).max(2);
    Ok((even(width), even(height)))
}

#[cfg(windows)]
mod native {
    use super::*;
    use serde::Serialize;
    use std::{
        ffi::OsStr,
        fs::{self, File},
        path::Path,
        sync::{atomic::AtomicU32, Arc},
        time::Duration,
    };
    use tauri::{Emitter, Manager};
    use windows::{
        core::{HRESULT, HSTRING},
        Media::{
            MediaProperties::{
                AudioEncodingProperties, MediaEncodingProfile, VideoEncodingQuality,
            },
            Transcoding::MediaTranscoder,
        },
        Storage::StorageFile,
        Win32::{
            Foundation::E_POINTER,
            System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
        },
    };
    use windows_future::{AsyncActionProgressHandler, AsyncStatus};

    const VIDEO_EXTENSIONS: &[&str] = &[
        "mp4", "m4v", "mov", "wmv", "avi", "mkv", "webm", "3gp", "3g2", "mts", "m2ts", "ts", "mpg",
        "mpeg",
    ];
    const WAIT_INTERVAL: Duration = Duration::from_millis(150);

    #[derive(Clone, Copy, Serialize)]
    struct Progress {
        index: usize,
        total: usize,
        percent: u32,
    }

    struct ActiveJob<'a> {
        window: &'a WebviewWindow,
        flag: &'a AtomicU8,
    }

    impl ActiveJob<'_> {
        fn cancelled(&self) -> bool {
            self.flag.load(Ordering::Acquire) == CANCELLING
        }
    }

    impl Drop for ActiveJob<'_> {
        fn drop(&mut self) {
            self.flag.store(IDLE, Ordering::Release);
        }
    }

    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe { RoUninitialize() };
        }
    }

    pub(crate) fn shrink(
        window: &WebviewWindow,
        paths: &[PathBuf],
        quality: Quality,
    ) -> Result<Outcome, String> {
        if !paths.iter().all(|path| {
            path.is_file()
                && path.extension().and_then(OsStr::to_str).is_some_and(|ext| {
                    VIDEO_EXTENSIONS
                        .iter()
                        .any(|format| ext.eq_ignore_ascii_case(format))
                })
        }) {
            return Err("Drop video files to shrink them".into());
        }
        let state = window.state::<VideoJob>();
        state
            .0
            .compare_exchange(IDLE, RUNNING, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "Poni is already shrinking a video")?;
        let job = ActiveJob {
            window,
            flag: &state.0,
        };
        unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.map_err(|error| error.to_string())?;
        let _apartment = Apartment;
        let mut saved = Vec::new();
        let mut errors = Vec::new();
        for (index, path) in paths.iter().enumerate() {
            if job.cancelled() {
                break;
            }
            let progress = Progress {
                index: index + 1,
                total: paths.len(),
                percent: 0,
            };
            let _ = window.emit("poni-video-progress", progress);
            match transcode(path, quality, &job, progress) {
                Ok(Some(output)) => saved.push(output),
                Ok(None) => {}
                Err(error) => errors.push(format!("{}: {error}", path.display())),
            }
        }
        let cancelled = job.cancelled();
        if let Some(error) = errors.first() {
            if saved.is_empty() && !cancelled {
                return Err(error.clone());
            }
        }
        Ok(Outcome::Video {
            paths: saved,
            cancelled,
            failed: errors.len(),
        })
    }

    fn output_profile(
        input: &StorageFile,
        quality: Quality,
    ) -> Result<MediaEncodingProfile, String> {
        let original = MediaEncodingProfile::CreateFromFileAsync(input)
            .and_then(|operation| operation.get())
            .map_err(|error| error.to_string())?;
        let input_video = original.Video().map_err(|error| error.to_string())?;
        let (width_limit, max_bitrate, max_audio_bitrate) = quality.video();
        let settings = || -> windows::core::Result<MediaEncodingProfile> {
            let (width, height) =
                dimensions(input_video.Width()?, input_video.Height()?, width_limit).map_err(
                    |error| windows::core::Error::new(HRESULT(0x80070057_u32 as i32), error),
                )?;
            let output = MediaEncodingProfile::CreateMp4(VideoEncodingQuality::HD1080p)?;
            let video = output.Video()?;
            video.SetWidth(width)?;
            video.SetHeight(height)?;
            let bitrate = input_video.Bitrate()?;
            video.SetBitrate(if bitrate == 0 {
                max_bitrate
            } else {
                (bitrate.saturating_mul(3) / 4).clamp(100_000, max_bitrate)
            })?;
            let input_rate = input_video.FrameRate()?;
            let (numerator, denominator) = (input_rate.Numerator()?, input_rate.Denominator()?);
            if numerator != 0 && denominator != 0 && numerator / denominator <= 60 {
                let rate = video.FrameRate()?;
                rate.SetNumerator(numerator)?;
                rate.SetDenominator(denominator)?;
            }
            match original.Audio() {
                Ok(input_audio) => {
                    let bitrate = input_audio.Bitrate()?;
                    output.Audio()?.SetBitrate(if bitrate == 0 {
                        max_audio_bitrate
                    } else {
                        bitrate.min(max_audio_bitrate).max(48_000)
                    })?;
                }
                Err(error) if error.code() == E_POINTER => {
                    output.SetAudio(None::<&AudioEncodingProperties>)?
                }
                Err(error) => return Err(error),
            }
            Ok(output)
        };
        settings().map_err(|error| error.to_string())
    }

    fn transcode(
        path: &Path,
        quality: Quality,
        job: &ActiveJob<'_>,
        progress: Progress,
    ) -> Result<Option<PathBuf>, String> {
        let parent = path.parent().ok_or("Could not find the video's folder")?;
        let original_size = fs::metadata(path).map_err(|error| error.to_string())?.len();
        let staged = tempfile::Builder::new()
            .prefix(".poni-video-")
            .suffix(".mp4")
            .tempfile_in(parent)
            .map_err(|error| error.to_string())?
            .into_temp_path();
        let encode = || -> Result<bool, String> {
            let mut progress = progress;
            let file_for = |path: &Path| {
                StorageFile::GetFileFromPathAsync(&HSTRING::from(path.as_os_str()))
                    .and_then(|result| result.get())
                    .map_err(|error| error.to_string())
            };
            let source = file_for(path)?;
            let destination = file_for(&staged)?;
            let output = output_profile(&source, quality)?;
            let worker = MediaTranscoder::new().map_err(|error| error.to_string())?;
            worker
                .SetAlwaysReencode(true)
                .map_err(|error| error.to_string())?;
            let prepared = worker
                .PrepareFileTranscodeAsync(&source, &destination, &output)
                .and_then(|operation| operation.get())
                .map_err(|error| error.to_string())?;
            if !prepared.CanTranscode().map_err(|error| error.to_string())? {
                let reason = prepared
                    .FailureReason()
                    .map_err(|error| error.to_string())?;
                return Err(format!(
                    "Windows could not transcode the video ({reason:?})"
                ));
            }
            if job.cancelled() {
                return Ok(false);
            }
            let action = prepared
                .TranscodeAsync()
                .map_err(|error| error.to_string())?;
            let latest = Arc::new(AtomicU32::new(0));
            let report = Arc::clone(&latest);
            let _ =
                action.SetProgress(&AsyncActionProgressHandler::<f64>::new(move |_, amount| {
                    report.store(
                        (*amount).clamp(0.0, 100.0).round() as u32,
                        Ordering::Relaxed,
                    );
                    Ok(())
                }));
            let mut cancellation_sent = false;
            while action.Status().map_err(|error| error.to_string())? == AsyncStatus::Started {
                if job.cancelled() && !cancellation_sent {
                    action.Cancel().map_err(|error| error.to_string())?;
                    cancellation_sent = true;
                }
                let current = latest.load(Ordering::Relaxed);
                if current != progress.percent {
                    progress.percent = current;
                    let _ = job.window.emit("poni-video-progress", progress);
                }
                std::thread::sleep(WAIT_INTERVAL);
            }
            if cancellation_sent || job.cancelled() {
                return Ok(false);
            }
            action.GetResults().map_err(|error| error.to_string())?;
            Ok(true)
        };
        if !encode()? || job.cancelled() {
            return Ok(None);
        }
        let file = File::options()
            .write(true)
            .open(&staged)
            .map_err(|error| error.to_string())?;
        let size = file.metadata().map_err(|error| error.to_string())?.len();
        if size == 0 || size >= original_size {
            return Ok(None);
        }
        file.sync_all().map_err(|error| error.to_string())?;
        let mut name = path
            .file_stem()
            .unwrap_or_else(|| OsStr::new("Video"))
            .to_owned();
        name.push(" (smaller).mp4");
        let staged = tempfile::NamedTempFile::from_parts(file, staged);
        crate::drop_actions::persist_unique_file(parent, &name, staged).map(Some)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caps_the_width_for_each_preset_without_enlarging_small_clips() {
        assert_eq!(
            dimensions(3840, 2160, Quality::Light.video().0).unwrap(),
            (1920, 1080)
        );
        assert_eq!(
            dimensions(1920, 1080, Quality::Medium.video().0).unwrap(),
            (1280, 720)
        );
        assert_eq!(
            dimensions(1920, 1080, Quality::Strong.video().0).unwrap(),
            (854, 480)
        );
        assert_eq!(
            dimensions(320, 240, Quality::Medium.video().0).unwrap(),
            (320, 240)
        );
        assert!(dimensions(0, 0, 1280).is_err());
    }
}
