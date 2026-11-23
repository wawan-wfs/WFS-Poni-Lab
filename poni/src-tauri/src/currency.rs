use std::{
    collections::BTreeMap,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use tauri::State;

use super::{bookmarks::open_in_default_browser, Store};

const ECB_RATES: &str = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const OPEN_RATES: &str = "https://open.er-api.com/v6/latest/USD";
const ECB_REFERENCE: &str = "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html";
const OPEN_REFERENCE: &str = "https://www.exchangerate-api.com";
const CACHE_LIFETIME: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_RESPONSE: usize = 128 * 1024;
const MAX_FAVOURITES: usize = 8;
const COMMON: [&str; 6] = ["USD", "EUR", "SGD", "MYR", "JPY", "SAR"];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct CurrencyPair {
    from: String,
    to: String,
}

impl CurrencyPair {
    fn new(from: &str, to: &str) -> Self {
        Self {
            from: from.to_owned(),
            to: to.to_owned(),
        }
    }

    fn valid(&self) -> bool {
        self.from != self.to && valid_code(&self.from) && valid_code(&self.to)
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct CurrencyPreferences {
    pair: CurrencyPair,
    favourites: Vec<CurrencyPair>,
}

impl CurrencyPreferences {
    fn regional(local: &str) -> Self {
        let mut favourites = Vec::new();
        if local != "USD" {
            favourites.push(CurrencyPair::new(local, "USD"));
        }
        for code in COMMON {
            if code != local
                && !favourites
                    .iter()
                    .any(|pair| pair.from == code || pair.to == code)
            {
                favourites.push(CurrencyPair::new(code, local));
            }
        }
        let pair = favourites[0].clone();
        Self { pair, favourites }
    }

    fn validate(&self) -> Result<(), String> {
        if !self.pair.valid() || self.favourites.len() > MAX_FAVOURITES {
            return Err("Choose a valid currency pair and up to eight favourites".into());
        }
        for (index, pair) in self.favourites.iter().enumerate() {
            if !pair.valid() || self.favourites[..index].contains(pair) {
                return Err("Favourite pairs must be valid and unique".into());
            }
        }
        Ok(())
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct RateTable {
    #[serde(default = "legacy_base")]
    base: String,
    date: String,
    rates: BTreeMap<String, f64>,
    fetched_at: u64,
}

fn legacy_base() -> String {
    "USD".into()
}

impl RateTable {
    fn new(
        base: &str,
        date: String,
        rates: BTreeMap<String, f64>,
        fetched_at: u64,
    ) -> Result<Self, String> {
        if NaiveDate::parse_from_str(&date, "%Y-%m-%d").is_err()
            || rates.is_empty()
            || rates.len() > 200
            || rates
                .iter()
                .any(|(code, value)| !valid_code(code) || !value.is_finite() || *value <= 0.0)
        {
            return Err("The exchange rate provider sent invalid rates".into());
        }
        Ok(Self {
            base: base.to_owned(),
            date,
            rates,
            fetched_at,
        })
    }

    fn fresh(&self, now: u64) -> bool {
        now.checked_sub(self.fetched_at)
            .is_some_and(|age| age < CACHE_LIFETIME.as_secs())
    }
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub(crate) struct CurrencyData {
    preferences: Option<CurrencyPreferences>,
    #[serde(alias = "table")]
    ecb: Option<RateTable>,
    open: Option<RateTable>,
}

#[derive(Serialize)]
pub(crate) struct CurrencySnapshot {
    preferences: CurrencyPreferences,
    local: String,
    locale: Option<String>,
    ecb: Option<RateTable>,
    open: Option<RateTable>,
    due: bool,
    errors: BTreeMap<&'static str, String>,
}

impl CurrencyData {
    fn ecb_due(&self, now: u64) -> bool {
        self.ecb
            .as_ref()
            .is_none_or(|table| table.base != "EUR" || !table.fresh(now))
    }

    fn snapshot(&self, now: u64) -> CurrencySnapshot {
        let (local, locale) = regional_currency();
        CurrencySnapshot {
            preferences: self
                .preferences
                .clone()
                .unwrap_or_else(|| CurrencyPreferences::regional(&local)),
            local,
            locale,
            ecb: self.ecb.clone(),
            open: self.open.clone(),
            due: self.ecb_due(now) || self.open.as_ref().is_none_or(|table| !table.fresh(now)),
            errors: BTreeMap::new(),
        }
    }
}

#[cfg(windows)]
fn regional_currency() -> (String, Option<String>) {
    use windows_sys::Win32::Globalization::{
        GetLocaleInfoEx, GetUserDefaultLocaleName, LOCALE_SINTLSYMBOL,
    };
    let mut currency = [0_u16; 16];
    let mut locale = [0_u16; 85];
    // A null locale name selects the Windows user default.
    let currency_length = unsafe {
        GetLocaleInfoEx(
            std::ptr::null(),
            LOCALE_SINTLSYMBOL,
            currency.as_mut_ptr(),
            currency.len() as i32,
        )
    };
    let locale_length =
        unsafe { GetUserDefaultLocaleName(locale.as_mut_ptr(), locale.len() as i32) };
    let read = |buffer: &[u16], length: i32| {
        let count = usize::try_from(length).ok()?.checked_sub(1)?;
        String::from_utf16(buffer.get(..count)?).ok()
    };
    (
        read(&currency, currency_length)
            .filter(|code| valid_code(code))
            .unwrap_or_else(|| "USD".into()),
        read(&locale, locale_length).filter(|locale| !locale.is_empty()),
    )
}

#[cfg(not(windows))]
fn regional_currency() -> (String, Option<String>) {
    ("USD".into(), None)
}

#[derive(Deserialize)]
struct OpenRates {
    result: String,
    base_code: String,
    time_last_update_unix: i64,
    rates: BTreeMap<String, f64>,
}

impl OpenRates {
    fn into_table(self, fetched_at: u64) -> Result<RateTable, String> {
        if self.result != "success" || self.base_code != "USD" || self.time_last_update_unix <= 0 {
            return Err("ExchangeRate-API sent an invalid response".into());
        }
        let date = DateTime::<Utc>::from_timestamp(self.time_last_update_unix, 0)
            .ok_or("ExchangeRate-API sent an invalid date")?
            .date_naive()
            .to_string();
        RateTable::new("USD", date, self.rates, fetched_at)
    }
}

// The official daily ECB feed carries only Cube elements with fixed-format attributes.
// Treat its tags as data, with no XML entity or external-document resolution.
fn parse_ecb(body: &str, fetched_at: u64) -> Result<RateTable, String> {
    let mut date = None;
    let mut rates = BTreeMap::new();
    for cube in body.split("<Cube ").skip(1) {
        let tag = cube.split_once('>').ok_or("ECB sent an incomplete Cube")?.0;
        let attribute = |key: &str| {
            let (_, value) = tag.split_once(key)?;
            let quote = value.chars().next()?;
            if !matches!(quote, '\'' | '"') {
                return None;
            }
            value[quote.len_utf8()..]
                .split_once(quote)
                .map(|(text, _)| text)
        };
        if let Some(time) = attribute("time=") {
            if date.replace(time).is_some() {
                return Err("ECB sent multiple rate dates".into());
            }
        } else if let Some(symbol) = attribute("currency=") {
            let rate = attribute("rate=")
                .and_then(|value| value.parse().ok())
                .ok_or("ECB sent an invalid rate")?;
            if rates.insert(symbol.to_owned(), rate).is_some() {
                return Err("ECB sent duplicate rates".into());
            }
        }
    }
    RateTable::new(
        "EUR",
        date.ok_or("ECB sent no rate date")?.to_owned(),
        rates,
        fetched_at,
    )
}

fn valid_code(code: &str) -> bool {
    code.len() == 3 && code.bytes().all(|byte| byte.is_ascii_uppercase())
}

fn unix_now() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|_| "Check your computer clock".into())
}

async fn fetch(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|_| "Cannot connect to the exchange rate provider")?;
    if !response.status().is_success() {
        return Err("The exchange rate provider is unavailable".into());
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE as u64)
    {
        return Err("The exchange rate response exceeds the size limit".into());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Cannot read the exchange rate response")?
    {
        if body.len().saturating_add(chunk.len()) > MAX_RESPONSE {
            return Err("The exchange rate response exceeds the size limit".into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

#[tauri::command]
pub(crate) fn currency_snapshot(
    store: State<'_, Mutex<Store>>,
) -> Result<CurrencySnapshot, String> {
    let now = unix_now()?;
    Ok(store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .data
        .currency
        .snapshot(now))
}

#[tauri::command]
pub(crate) fn save_currency_preferences(
    store: State<'_, Mutex<Store>>,
    preferences: CurrencyPreferences,
) -> Result<CurrencyPreferences, String> {
    preferences.validate()?;
    store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            data.currency.preferences = Some(preferences.clone());
            Ok(())
        })?;
    Ok(preferences)
}

#[tauri::command]
pub(crate) async fn refresh_currency_rates(
    store: State<'_, Mutex<Store>>,
) -> Result<CurrencySnapshot, String> {
    let now = unix_now()?;
    let (ecb_due, open_due) = {
        let saved = store.lock().map_err(|_| "Storage unavailable")?;
        let currency = &saved.data.currency;
        (
            currency.ecb_due(now),
            currency.open.as_ref().is_none_or(|table| !table.fresh(now)),
        )
    };
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| "Cannot initialize exchange rates")?;
    let ecb_client = client.clone();
    let ecb = ecb_due.then(|| {
        tauri::async_runtime::spawn(async move {
            let bytes = fetch(&ecb_client, ECB_RATES).await?;
            parse_ecb(
                std::str::from_utf8(&bytes).map_err(|_| "ECB sent invalid text")?,
                unix_now()?,
            )
        })
    });
    let open = open_due.then(|| {
        tauri::async_runtime::spawn(async move {
            let bytes = fetch(&client, OPEN_RATES).await?;
            let response: OpenRates =
                serde_json::from_slice(&bytes).map_err(|_| "ExchangeRate-API sent invalid JSON")?;
            response.into_table(unix_now()?)
        })
    });

    let mut errors = BTreeMap::new();
    let mut received = Vec::new();
    for (source, task) in [("ecb", ecb), ("open", open)] {
        if let Some(task) = task {
            match task
                .await
                .map_err(|_| "Rate request did not finish".to_owned())
                .and_then(|result| result)
            {
                Ok(table) => received.push((source, table)),
                Err(error) => {
                    errors.insert(source, error);
                }
            }
        }
    }
    let mut store = store.lock().map_err(|_| "Storage unavailable")?;
    if !received.is_empty() {
        store.update(|data| {
            for (source, table) in received {
                let old = if source == "ecb" {
                    &mut data.currency.ecb
                } else {
                    &mut data.currency.open
                };
                if let Some(saved) = old {
                    if saved.date > table.date || saved.fetched_at > table.fetched_at {
                        continue;
                    }
                }
                *old = Some(table);
            }
            Ok(())
        })?;
    }
    let mut snapshot = store.data.currency.snapshot(now);
    snapshot.errors = errors;
    Ok(snapshot)
}

#[tauri::command]
pub(crate) fn open_currency_source(source: String) -> Result<(), String> {
    let address = match source.as_str() {
        "ecb" => ECB_REFERENCE,
        "open" => OPEN_REFERENCE,
        _ => return Err("Unknown rate source".into()),
    };
    open_in_default_browser(reqwest::Url::parse(address).map_err(|_| "Invalid rate source")?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_official_feed_shape() {
        let table = parse_ecb(
            "<Cube><Cube time='2026-11-20'><Cube currency='USD' rate='1.0990'/><Cube currency='IDR' rate='20071.37'/></Cube></Cube>",
            100,
        ).unwrap();
        assert_eq!(table.base, "EUR");
        assert_eq!(table.date, "2026-11-20");
        assert_eq!(table.rates["IDR"], 20_071.37);
        assert!(table.fresh(100));
        assert!(!table.fresh(100 + CACHE_LIFETIME.as_secs()));
        assert!(parse_ecb(
            "<Cube time='2026-11-20'><Cube currency='USD' rate='0'/>",
            100
        )
        .is_err());
    }

    #[test]
    fn keeps_legacy_pair_and_cache() {
        let saved: CurrencyData = serde_json::from_str(
            r#"{
          "preferences": {"pair":{"from":"USD","to":"IDR"},"favourites":[]},
          "table": {"date":"2026-11-20","rates":{"USD":1,"IDR":18263},"fetched_at":100}
        }"#,
        )
        .unwrap();
        assert_eq!(saved.ecb.unwrap().base, "USD");
        assert_eq!(
            saved.preferences.unwrap().pair,
            CurrencyPair::new("USD", "IDR")
        );
        assert_eq!(
            CurrencyPreferences::regional("IDR").pair,
            CurrencyPair::new("IDR", "USD")
        );
        assert_eq!(
            CurrencyPreferences::regional("USD").pair,
            CurrencyPair::new("EUR", "USD")
        );
    }
}
