use super::Store;
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use std::{sync::Mutex, time::Duration};
use tauri::State;

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct Station {
    id: String,
    name: String,
    url: String,
    country: String,
    codec: String,
    tags: String,
}

impl Station {
    fn validate(&self) -> Result<(), String> {
        if self.id.is_empty()
            || self.id.len() > 80
            || self.name.trim().is_empty()
            || self.name.len() > 512
            || self.url.len() > 2048
            || self.tags.len() > 512
            || !matches!(self.codec.as_str(), "MP3" | "AAC" | "AAC+")
            || !self.country.bytes().all(|byte| byte.is_ascii_uppercase())
            || !matches!(self.country.len(), 0 | 2)
        {
            return Err("Invalid radio station".into());
        }
        let url = Url::parse(&self.url).map_err(|_| "Invalid station address")?;
        let host = url
            .domain()
            .ok_or("Station address must contain a domain")?;
        if url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || !host.contains('.')
            || host.ends_with(".local")
            || host.ends_with(".localhost")
            || host.ends_with(".internal")
            || host.ends_with('.')
        {
            return Err("Station must provide a public HTTPS audio stream".into());
        }
        Ok(())
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(default)]
pub(crate) struct RadioData {
    volume: u8,
    country: Option<String>,
    favourites: Vec<Station>,
    recent: Vec<Station>,
}

impl Default for RadioData {
    fn default() -> Self {
        Self {
            volume: 60,
            country: None,
            favourites: Vec::new(),
            recent: Vec::new(),
        }
    }
}

#[derive(Deserialize)]
struct DirectoryStation {
    stationuuid: String,
    name: String,
    url_resolved: String,
    countrycode: String,
    codec: String,
    tags: String,
    hls: u8,
}

impl DirectoryStation {
    fn into_playable(self) -> Option<Station> {
        if self.hls != 0 {
            return None;
        }
        let station = Station {
            id: self.stationuuid,
            name: self.name.trim().to_owned(),
            url: self.url_resolved,
            country: self.countrycode,
            codec: self.codec.to_ascii_uppercase(),
            tags: self.tags,
        };
        station.validate().ok()?;
        Some(station)
    }
}

fn country_code(input: &str) -> Result<String, String> {
    let code = input.trim().to_ascii_uppercase();
    if !code.is_empty() && (code.len() != 2 || !code.bytes().all(|byte| byte.is_ascii_uppercase()))
    {
        return Err("Use a two-letter country code, such as ID or US".into());
    }
    Ok(code)
}

#[tauri::command]
pub(crate) fn get_radio(store: State<'_, Mutex<Store>>) -> Result<RadioData, String> {
    Ok(store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .data
        .radio
        .clone())
}

#[tauri::command]
pub(crate) fn set_radio_preferences(
    store: State<'_, Mutex<Store>>,
    volume: u8,
    country: String,
) -> Result<RadioData, String> {
    let country = country_code(&country)?;
    if volume > 100 {
        return Err("Volume must be between 0 and 100".into());
    }
    let data = store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            data.radio.volume = volume;
            data.radio.country = Some(country);
            Ok(())
        })?;
    Ok(data.radio)
}

#[tauri::command]
pub(crate) fn update_radio_stations(
    store: State<'_, Mutex<Store>>,
    action: String,
    station: Station,
) -> Result<RadioData, String> {
    station.validate()?;
    let data = store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            match action.as_str() {
                "favourite" => {
                    let items = &mut data.radio.favourites;
                    if let Some(index) = items.iter().position(|item| item.id == station.id) {
                        items.remove(index);
                    } else {
                        if items.len() >= 100 {
                            return Err("You can save up to 100 favourite stations".into());
                        }
                        items.insert(0, station);
                    }
                }
                "recent" => {
                    let items = &mut data.radio.recent;
                    items.retain(|item| item.id != station.id);
                    items.insert(0, station);
                    items.truncate(20);
                }
                "forget" => data.radio.recent.retain(|item| item.id != station.id),
                _ => return Err("Unknown radio action".into()),
            }
            Ok(())
        })?;
    Ok(data.radio)
}

#[tauri::command]
pub(crate) async fn find_radio_stations(
    country: String,
    query: String,
    genre: bool,
) -> Result<Vec<Station>, String> {
    let code = country_code(&country)?;
    let query = query.trim();
    if query.chars().count() > 80 || query.chars().any(char::is_control) {
        return Err("Search text must contain at most 80 characters".into());
    }
    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .user_agent("PoniRebuild/0.1 Radio")
        .build()
        .map_err(|_| "Could not start the station search")?;
    for endpoint in [
        "https://de1.api.radio-browser.info/json/stations/search",
        "https://de2.api.radio-browser.info/json/stations/search",
    ] {
        let mut url = Url::parse(endpoint).expect("valid directory address");
        let filter = if genre { "tag" } else { "name" };
        url.query_pairs_mut()
            .append_pair("limit", "70")
            .append_pair("order", "votes")
            .append_pair("reverse", "true")
            .append_pair("is_https", "true")
            .append_pair("hidebroken", "true")
            .append_pair("countrycode", &code)
            .append_pair(filter, query);
        let Ok(response) = client
            .get(url)
            .send()
            .await
            .and_then(|response| response.error_for_status())
        else {
            continue;
        };
        if response
            .content_length()
            .is_some_and(|length| length > 512_000)
        {
            continue;
        }
        // The directory is remote input. Stop reading if it exceeds the response budget.
        let mut response = response;
        let mut body = Vec::new();
        loop {
            match response.chunk().await {
                Ok(Some(chunk)) if body.len() + chunk.len() <= 512_000 => {
                    body.extend_from_slice(&chunk)
                }
                Ok(None) => {
                    if let Ok(rows) = serde_json::from_slice::<Vec<DirectoryStation>>(&body) {
                        return Ok(rows
                            .into_iter()
                            .filter_map(DirectoryStation::into_playable)
                            .take(30)
                            .collect());
                    }
                    break;
                }
                _ => break,
            }
        }
    }
    Err("Could not reach Radio Browser. Try again.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn directory_only_returns_direct_public_audio_streams() {
        let station = DirectoryStation {
            stationuuid: "example".into(),
            name: "Test".into(),
            url_resolved: "https://example.com/radio.mp3".into(),
            countrycode: "ID".into(),
            codec: "MP3".into(),
            tags: "".into(),
            hls: 0,
        }
        .into_playable()
        .unwrap();
        assert!(station.validate().is_ok());
        for url in [
            "http://example.com/audio",
            "https://127.0.0.1/audio",
            "https://radio.local/stream",
            "https://user@example.com/stream",
        ] {
            let station = Station {
                url: url.into(),
                ..station.clone()
            };
            assert!(station.validate().is_err());
        }
    }
}
