use std::{
    collections::BTreeMap,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::State;

use super::Store;

const RATES_URL: &str = "https://api.frankfurter.dev/v1/latest?base=USD";
const CACHE_LIFETIME: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_FAVOURITES: usize = 8;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct CurrencyPair {
    from: String,
    to: String,
}

impl CurrencyPair {
    fn valid(&self) -> bool {
        self.from != self.to && valid_code(&self.from) && valid_code(&self.to)
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct CurrencyPreferences {
    pair: CurrencyPair,
    favourites: Vec<CurrencyPair>,
}

impl Default for CurrencyPreferences {
    fn default() -> Self {
        let pair = CurrencyPair {
            from: "USD".into(),
            to: "IDR".into(),
        };
        Self {
            favourites: vec![pair.clone()],
            pair,
        }
    }
}

impl CurrencyPreferences {
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
    date: String,
    rates: BTreeMap<String, f64>,
    fetched_at: u64,
}

impl RateTable {
    fn fresh(&self, now: u64) -> bool {
        now.checked_sub(self.fetched_at)
            .is_some_and(|age| age < CACHE_LIFETIME.as_secs())
    }
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub(crate) struct CurrencyData {
    preferences: CurrencyPreferences,
    table: Option<RateTable>,
}

#[derive(Deserialize)]
struct ProviderRates {
    base: String,
    date: String,
    rates: BTreeMap<String, f64>,
}

impl ProviderRates {
    fn into_table(self, fetched_at: u64) -> Result<RateTable, String> {
        let date = self.date.as_bytes();
        let has_date_shape = date.len() == 10
            && date[4] == b'-'
            && date[7] == b'-'
            && date
                .iter()
                .enumerate()
                .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit());
        if self.base != "USD" || !has_date_shape || self.rates.is_empty() || self.rates.len() > 200
        {
            return Err("The exchange rate provider sent an invalid response".into());
        }
        let mut rates = self.rates;
        if rates
            .iter()
            .any(|(code, value)| !valid_code(code) || !value.is_finite() || *value <= 0.0)
        {
            return Err("The exchange rate provider sent invalid rates".into());
        }
        rates.insert("USD".into(), 1.0);
        Ok(RateTable {
            date: self.date,
            rates,
            fetched_at,
        })
    }
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

#[tauri::command]
pub(crate) fn currency_snapshot(store: State<'_, Mutex<Store>>) -> Result<CurrencyData, String> {
    Ok(store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .data
        .currency
        .clone())
}

#[tauri::command]
pub(crate) fn save_currency_preferences(
    store: State<'_, Mutex<Store>>,
    preferences: CurrencyPreferences,
) -> Result<CurrencyPreferences, String> {
    preferences.validate()?;
    let data = store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            data.currency.preferences = preferences;
            Ok(())
        })?;
    Ok(data.currency.preferences)
}

#[tauri::command]
pub(crate) async fn refresh_currency_rates(
    store: State<'_, Mutex<Store>>,
) -> Result<RateTable, String> {
    let now = unix_now()?;
    {
        let store = store.lock().map_err(|_| "Storage unavailable")?;
        if let Some(table) = &store.data.currency.table {
            if table.fresh(now) {
                return Ok(table.clone());
            }
        }
    }

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| "Cannot initialize exchange rates")?;
    let response = client
        .get(RATES_URL)
        .send()
        .await
        .map_err(|_| "Cannot connect to the exchange rate provider")?;
    if !response.status().is_success() {
        return Err("The exchange rate provider is unavailable".into());
    }
    let provider: ProviderRates = response
        .json()
        .await
        .map_err(|_| "Cannot read the exchange rate provider response")?;
    let table = provider.into_table(unix_now()?)?;

    let mut store = store.lock().map_err(|_| "Storage unavailable")?;
    if let Some(existing) = &store.data.currency.table {
        if existing.date > table.date || existing.fresh(table.fetched_at) {
            return Ok(existing.clone());
        }
    }
    store.update(|data| {
        data.currency.table = Some(table.clone());
        Ok(())
    })?;
    Ok(table)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_usd_table_and_rejects_unusable_provider_rates() {
        let mut provider = ProviderRates {
            base: "USD".into(),
            date: "2026-11-20".into(),
            rates: BTreeMap::from([("IDR".into(), 18_263.0)]),
        };
        let table = ProviderRates {
            rates: provider.rates.clone(),
            base: provider.base.clone(),
            date: provider.date.clone(),
        }
        .into_table(100)
        .unwrap();
        assert_eq!(table.rates["IDR"] / table.rates["USD"], 18_263.0);
        assert!(table.fresh(100));
        assert!(!table.fresh(100 + CACHE_LIFETIME.as_secs()));
        provider.rates.insert("EUR".into(), 0.0);
        assert!(provider.into_table(100).is_err());
    }
}
