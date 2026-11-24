use crate::{weather_client, Store};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State, WebviewWindow};

#[derive(Deserialize)]
struct Forecast {
    daily: SolarTimes,
}

#[derive(Deserialize)]
struct SolarTimes {
    sunrise: Vec<Option<u64>>,
    sunset: Vec<Option<u64>>,
}

#[derive(Serialize)]
pub(super) struct SolarDay {
    sunrise_ms: u64,
    sunset_ms: u64,
}

#[tauri::command]
pub(super) async fn get_poni_daylight(
    store: State<'_, Mutex<Store>>,
) -> Result<Vec<SolarDay>, String> {
    let city = {
        let store = store.lock().map_err(|_| "Storage unavailable")?;
        store
            .data
            .prayer_settings
            .as_ref()
            .map(|prayer| &prayer.location)
            .or(store.data.weather_location.as_ref())
            .cloned()
    };
    let Some(city) = city else {
        return Ok(Vec::new());
    };
    city.validate()?;
    let latitude = city.latitude.to_string();
    let longitude = city.longitude.to_string();
    let forecast = weather_client()?
        .get("https://api.open-meteo.com/v1/forecast")
        .query(&[
            ("latitude", latitude.as_str()),
            ("longitude", longitude.as_str()),
            ("daily", "sunrise,sunset"),
            ("timezone", "auto"),
            ("timeformat", "unixtime"),
            ("past_days", "1"),
            ("forecast_days", "3"),
        ])
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<Forecast>()
        .await
        .map_err(|error| error.to_string())?;
    Ok(forecast
        .daily
        .sunrise
        .into_iter()
        .zip(forecast.daily.sunset)
        .filter_map(|(rise, set)| {
            let (rise, set) = (rise?, set?);
            (rise < set).then_some(SolarDay {
                sunrise_ms: rise.saturating_mul(1000),
                sunset_ms: set.saturating_mul(1000),
            })
        })
        .collect())
}

#[tauri::command]
pub(super) fn preview_night_warmth(
    app: AppHandle,
    window: WebviewWindow,
    strength: u16,
) -> Result<(), String> {
    if window.label() != "settings" || !(10..=100).contains(&strength) || strength % 5 != 0 {
        return Err("Choose a valid warmth setting".into());
    }
    app.emit_to("main", "poni-night-warmth-preview", strength)
        .map_err(|error| error.to_string())
}
