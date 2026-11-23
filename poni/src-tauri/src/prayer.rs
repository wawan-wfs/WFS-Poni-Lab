use super::{weather_client, AppData, Store, WeatherLocation};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct PrayerSettings {
    location: WeatherLocation,
    method: u8,
    school: u8,
}

impl PrayerSettings {
    fn validate(&self) -> Result<(), String> {
        self.location.validate()?;
        if !matches!(self.method, 1..=5 | 8..=14 | 16..=23) || self.school > 1 {
            return Err("Invalid prayer calculation method or Asr school".into());
        }
        Ok(())
    }
}

#[derive(Deserialize)]
struct DayResponse {
    data: PrayerDay,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct PrayerDay {
    timings: PrayerTimes,
    meta: PrayerMeta,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct PrayerTimes {
    fajr: String,
    sunrise: String,
    dhuhr: String,
    asr: String,
    maghrib: String,
    isha: String,
    imsak: String,
}

#[derive(Serialize, Deserialize)]
struct PrayerMeta {
    timezone: String,
}

fn provider_date(date: &str) -> Result<String, String> {
    let [year, month, day] = date.split('-').collect::<Vec<_>>()[..] else {
        return Err("Date must use YYYY-MM-DD".into());
    };
    if year.len() != 4
        || month.len() != 2
        || day.len() != 2
        || ![year, month, day]
            .iter()
            .all(|part| part.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return Err("Date must use YYYY-MM-DD".into());
    }
    let (year_number, month_number, day_number) = (
        year.parse::<u16>().unwrap_or(0),
        month.parse::<u8>().unwrap_or(0),
        day.parse::<u8>().unwrap_or(0),
    );
    let leap = (year_number % 4 == 0 && year_number % 100 != 0) || year_number % 400 == 0;
    let month_days = match month_number {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => 0,
    };
    if !(1900..=9999).contains(&year_number) || !(1..=month_days).contains(&day_number) {
        return Err("Invalid date for prayer timetable".into());
    }
    Ok(format!("{day}-{month}-{year}"))
}

#[tauri::command]
pub(crate) fn set_prayer_settings(
    store: State<'_, Mutex<Store>>,
    settings: PrayerSettings,
) -> Result<AppData, String> {
    settings.validate()?;
    store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            data.prayer_settings = Some(settings);
            Ok(())
        })
}

#[tauri::command]
pub(crate) async fn prayer_day(
    settings: PrayerSettings,
    date: String,
) -> Result<PrayerDay, String> {
    settings.validate()?;
    let date = provider_date(&date)?;
    let location = settings.location;
    let result = weather_client()?
        .get(format!("https://api.aladhan.com/v1/timings/{date}"))
        .query(&[
            ("latitude", location.latitude.to_string()),
            ("longitude", location.longitude.to_string()),
            ("method", settings.method.to_string()),
            ("school", settings.school.to_string()),
            ("iso8601", "true".into()),
        ])
        .send()
        .await
        .map_err(|_| "Could not reach AlAdhan")?
        .error_for_status()
        .map_err(|_| "AlAdhan did not return prayer times for this location and date")?
        .json::<DayResponse>()
        .await
        .map_err(|_| "AlAdhan returned an invalid prayer timetable")?;
    if result.data.meta.timezone.parse::<chrono_tz::Tz>().is_err() {
        return Err("AlAdhan returned an unrecognized time zone".into());
    }
    Ok(result.data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_a_real_date_for_the_provider() {
        assert_eq!(provider_date("2024-02-29").unwrap(), "29-02-2024");
        assert!(provider_date("2025-02-29").is_err());
        assert!(provider_date("2026-11-31").is_err());
        assert!(provider_date("2026-11-01/?").is_err());
    }
}
