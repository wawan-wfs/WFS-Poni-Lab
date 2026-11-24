use crate::Store;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewWindow};
use uuid::Uuid;
#[cfg(windows)]
use {std::time::Duration, tauri::WebviewWindowBuilder};

#[derive(Default)]
pub(super) struct Overlay {
    session: Option<Uuid>,
    labels: Vec<String>,
}

fn close(app: &AppHandle, session: Uuid) {
    let state = app.state::<Mutex<Overlay>>();
    let Ok(mut overlay) = state.lock() else {
        return;
    };
    if overlay.session != Some(session) {
        return;
    }
    overlay.session = None;
    let labels = std::mem::take(&mut overlay.labels);
    drop(overlay);
    for label in labels {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.destroy();
        }
    }
}

#[cfg(windows)]
fn open(app: &AppHandle, duration: u8) -> Result<(), String> {
    if !crate::activity::desktop_available() {
        return Ok(());
    }
    let state = app.state::<Mutex<Overlay>>();
    let main = app
        .get_webview_window("main")
        .ok_or("Notch is unavailable")?;
    let monitors = main
        .available_monitors()
        .map_err(|error| error.to_string())?;
    if monitors.is_empty() {
        return Err("No displays are available for the eye break".into());
    }
    let session = Uuid::new_v4();
    let page = format!("eye-break.html?session={session}&duration={duration}");
    {
        let mut overlay = state.lock().map_err(|_| "Eye break is unavailable")?;
        if overlay.session.is_some() {
            return Ok(());
        }
        overlay.session = Some(session);
    }
    let mut windows = Vec::with_capacity(monitors.len());
    for (index, monitor) in monitors.iter().enumerate() {
        let label = format!("eye-break-{session}-{index}");
        let result =
            WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::App(page.clone().into()))
                .title("Poni Eye Break")
                .visible(false)
                .focused(false)
                .decorations(false)
                .transparent(true)
                .resizable(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .build()
                .and_then(|window| {
                    if let Err(error) = window
                        .set_position(*monitor.position())
                        .and_then(|()| window.set_size(*monitor.size()))
                        .and_then(|()| crate::panel::position_client(&window, *monitor.position()))
                    {
                        let _ = window.destroy();
                        return Err(error);
                    }
                    Ok(window)
                });
        match result {
            Ok(window) => {
                let mut overlay = state.lock().map_err(|_| "Eye break is unavailable")?;
                if overlay.session != Some(session) {
                    drop(overlay);
                    let _ = window.destroy();
                    return Ok(());
                }
                overlay.labels.push(label);
                windows.push(window);
            }
            Err(error) => {
                close(app, session);
                return Err(error.to_string());
            }
        }
    }
    for window in &windows {
        if let Err(error) = window.show() {
            close(app, session);
            return Err(error.to_string());
        }
    }
    let focus = main
        .current_monitor()
        .ok()
        .flatten()
        .and_then(|active| {
            monitors
                .iter()
                .position(|monitor| monitor.position() == active.position())
        })
        .unwrap_or(0);
    let _ = windows[focus].set_focus();
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(u64::from(duration) + 4));
        let closer = handle.clone();
        let _ = handle.run_on_main_thread(move || close(&closer, session));
    });
    Ok(())
}

#[cfg(windows)]
pub(super) fn schedule(app: &AppHandle, duration: u8) -> bool {
    if !crate::activity::desktop_available() {
        return false;
    }
    let handle = app.clone();
    std::thread::Builder::new()
        .name("poni-eye-break".into())
        .spawn(move || {
            if let Err(error) = open(&handle, duration) {
                eprintln!("Could not open eye break: {error}");
                let _ = tauri::Emitter::emit_to(&handle, "main", "poni-eye-break-failed", error);
            }
        })
        .is_ok()
}

#[cfg(not(windows))]
pub(super) fn schedule(_app: &AppHandle, _duration: u8) -> bool {
    false
}

#[tauri::command]
pub(super) fn health_eye_break(
    app: AppHandle,
    store: tauri::State<'_, Mutex<Store>>,
) -> Result<bool, String> {
    let duration = store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .data
        .settings
        .health
        .eye_duration;
    Ok(schedule(&app, duration))
}

#[tauri::command]
pub(super) fn dismiss_eye_break(window: WebviewWindow, session: Uuid) -> Result<(), String> {
    if !window.label().starts_with("eye-break-") {
        return Err("This window is not an eye break".into());
    }
    let app = window.app_handle().clone();
    let handle = app.clone();
    app.run_on_main_thread(move || close(&handle, session))
        .map_err(|error| error.to_string())
}
