use serde::Deserialize;
use std::time::Duration;

const PROVIDER: &str = "https://api.mymemory.translated.net/get";
const MAX_INPUT_BYTES: usize = 500;
const LANGUAGES: &[&str] = &[
    "en", "id", "ms", "ar", "zh-CN", "ja", "ko", "th", "vi", "hi", "fr", "de", "es", "pt", "it",
    "nl", "ru", "tr",
];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Response {
    response_status: u16,
    response_data: Option<Translation>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Translation {
    translated_text: String,
}

fn validate_request<'a>(text: &'a str, from: &str, to: &str) -> Result<&'a str, String> {
    let text = text.trim();
    if text.is_empty() || text.len() > MAX_INPUT_BYTES {
        return Err("Enter between 1 and 500 bytes of text".into());
    }
    if from == to || !LANGUAGES.contains(&from) || !LANGUAGES.contains(&to) {
        return Err("Choose two different supported languages".into());
    }
    Ok(text)
}

impl Response {
    fn translation(self) -> Result<String, String> {
        if self.response_status == 429 {
            return Err("The translation provider's quota has been reached".into());
        }
        if self.response_status != 200 {
            return Err("The provider could not translate this text".into());
        }
        self.response_data
            .map(|data| data.translated_text)
            .filter(|text| !text.trim().is_empty() && text.len() <= 4_000)
            .ok_or_else(|| "The provider returned an unusable translation".into())
    }
}

#[tauri::command]
pub(crate) async fn translate_text(
    text: String,
    from: String,
    to: String,
) -> Result<String, String> {
    let text = validate_request(&text, &from, &to)?;
    let languages = format!("{from}|{to}");
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|_| "Cannot initialize translation")?;
    let response = client
        .get(PROVIDER)
        .query(&[("q", text), ("langpair", &languages)])
        .send()
        .await
        .map_err(|_| "Cannot connect to the translation provider")?;
    if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err("The translation provider's quota has been reached".into());
    }
    if !response.status().is_success() {
        return Err("The translation provider is unavailable".into());
    }
    response
        .json::<Response>()
        .await
        .map_err(|_| "Cannot read the translation response")?
        .translation()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_language_pairs_and_the_providers_utf8_limit() {
        assert_eq!(validate_request(" hello ", "en", "id").unwrap(), "hello");
        assert!(validate_request(&"界".repeat(167), "ja", "id").is_err());
        assert!(validate_request("hello", "en", "en").is_err());
        assert!(validate_request("hello", "en", "unknown").is_err());
    }

    #[test]
    fn handles_a_translation_and_provider_failure_payloads() {
        let success: Response = serde_json::from_str(
            r#"{"responseData":{"translatedText":"Halo Dunia"},"responseStatus":200}"#,
        )
        .unwrap();
        assert_eq!(success.translation().unwrap(), "Halo Dunia");
        let quota: Response = serde_json::from_str(r#"{"responseStatus":429}"#).unwrap();
        assert!(quota.translation().unwrap_err().contains("quota"));
    }
}
