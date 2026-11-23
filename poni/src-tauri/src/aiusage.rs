use super::Store;
use chrono::DateTime;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

const MAX_IMPORT_BYTES: usize = 256 * 1024;
const MAX_WINDOW_MINUTES: u32 = 31 * 24 * 60;
// Limit date values to the WebView's simple date range; older imports may be stale.
const LAST_TIMESTAMP: u64 = 4_102_444_800;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum Provider {
    Claude,
    Codex,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub(super) struct AiUsage {
    claude: Option<Snapshot>,
    codex: Option<Snapshot>,
}

impl AiUsage {
    fn slot(&mut self, provider: Provider) -> &mut Option<Snapshot> {
        match provider {
            Provider::Claude => &mut self.claude,
            Provider::Codex => &mut self.codex,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct Snapshot {
    plan: Option<String>,
    captured_at: Option<u64>,
    imported_at: u64,
    windows: Vec<Window>,
}

#[derive(Clone, Serialize, Deserialize)]
struct Window {
    label: String,
    used_percent: f64,
    window_minutes: u32,
    resets_at: Option<u64>,
}

impl Window {
    fn valid(&self) -> bool {
        !self.label.trim().is_empty()
            && self.label.chars().count() <= 64
            && !self.label.chars().any(char::is_control)
            && (0.0..=100.0).contains(&self.used_percent)
            && (1..=MAX_WINDOW_MINUTES).contains(&self.window_minutes)
    }
}

#[derive(Deserialize)]
struct UsageExport {
    plan: Option<String>,
    captured_at: Option<Value>,
    windows: Vec<Window>,
}

#[derive(Deserialize)]
struct CodexWindow {
    #[serde(alias = "usedPercent")]
    used_percent: f64,
    #[serde(alias = "windowDurationMins", alias = "windowMinutes")]
    window_minutes: Option<u32>,
    #[serde(alias = "resetsAt")]
    resets_at: Option<u64>,
}

#[derive(Deserialize)]
struct CodexLimits {
    #[serde(alias = "planType")]
    plan_type: Option<String>,
    primary: Option<CodexWindow>,
    secondary: Option<CodexWindow>,
}

#[derive(Deserialize)]
struct ClaudeWindow {
    utilization: f64,
    resets_at: Option<Value>,
}

fn timestamp(value: Option<&Value>) -> Result<Option<u64>, String> {
    let Some(value) = value.filter(|value| !value.is_null()) else {
        return Ok(None);
    };
    let epoch_seconds = if let Some(seconds) = value.as_u64() {
        Some(seconds)
    } else {
        value
            .as_str()
            .and_then(|date| DateTime::parse_from_rfc3339(date).ok())
            .and_then(|date| date.timestamp().try_into().ok())
    };
    epoch_seconds
        .and_then(|seconds| (1..=LAST_TIMESTAMP).contains(&seconds).then_some(seconds))
        .map(Some)
        .ok_or_else(|| "Dates must use RFC 3339 or Unix seconds.".into())
}

fn codex_windows(input: &Value) -> Result<(Option<String>, Vec<Window>), String> {
    let result = input.get("result").unwrap_or(input);
    let limits = result
        .get("rateLimits")
        .or_else(|| result.get("rate_limits"))
        .unwrap_or(result);
    let limits: CodexLimits =
        serde_json::from_value(limits.clone()).map_err(|_| "Invalid Codex rate limits.")?;
    let windows = [limits.primary, limits.secondary]
        .into_iter()
        .zip([300, 10_080])
        .filter_map(|(window, fallback)| window.map(|window| (window, fallback)))
        .map(|(window, fallback)| {
            let minutes = window.window_minutes.unwrap_or(fallback);
            let label = match minutes {
                300 => "5-hour session".into(),
                10_080 => "This week".into(),
                minutes if minutes % 60 == 0 => format!("{}-hour limit", minutes / 60),
                minutes => format!("{minutes}-minute limit"),
            };
            Window {
                label,
                used_percent: window.used_percent,
                window_minutes: minutes,
                resets_at: window.resets_at,
            }
        })
        .collect();
    Ok((limits.plan_type, windows))
}

fn claude_windows(input: &Value) -> Result<(Option<String>, Vec<Window>), String> {
    let entries = [
        ("five_hour", "5-hour session", 300),
        ("seven_day", "This week · all models", 10_080),
        ("seven_day_opus", "This week · Opus", 10_080),
        ("seven_day_sonnet", "This week · Sonnet", 10_080),
        ("seven_day_cowork", "This week · Cowork", 10_080),
    ];
    let mut windows = Vec::new();
    for (key, label, window_minutes) in entries {
        let Some(value) = input.get(key).filter(|value| !value.is_null()) else {
            continue;
        };
        let window: ClaudeWindow =
            serde_json::from_value(value.clone()).map_err(|_| "Invalid Claude usage window.")?;
        windows.push(Window {
            label: label.into(),
            used_percent: window.utilization,
            window_minutes,
            resets_at: timestamp(window.resets_at.as_ref())?,
        });
    }
    Ok((
        input.get("plan").and_then(Value::as_str).map(str::to_owned),
        windows,
    ))
}

fn read_snapshot(provider: Provider, raw: &str, now: u64) -> Result<Snapshot, String> {
    if raw.len() > MAX_IMPORT_BYTES {
        return Err("Usage JSON cannot exceed 256 KB.".into());
    }
    let input: Value = serde_json::from_str(raw).map_err(|_| "Invalid usage JSON.")?;
    let (plan, captured_at, windows) = if input.get("windows").is_some() {
        let export: UsageExport =
            serde_json::from_value(input).map_err(|_| "Invalid Poni usage export.")?;
        (
            export.plan,
            timestamp(export.captured_at.as_ref())?,
            export.windows,
        )
    } else {
        let captured_at = timestamp(input.get("timestamp").or_else(|| input.get("captured_at")))?;
        let (plan, windows) = match provider {
            Provider::Claude => claude_windows(&input)?,
            Provider::Codex => codex_windows(&input)?,
        };
        (plan, captured_at, windows)
    };
    if windows.is_empty() || windows.len() > 8 {
        return Err(
            "The file must contain one to eight usage windows for the selected provider.".into(),
        );
    }
    if !windows.iter().all(|window| {
        window.valid()
            && window
                .resets_at
                .is_none_or(|reset| (1..=LAST_TIMESTAMP).contains(&reset))
    }) {
        return Err("Usage windows need a percentage from 0 to 100 and a valid window duration and reset time.".into());
    }
    if captured_at.is_some_and(|seconds| seconds > now.saturating_add(300)) {
        return Err("The snapshot timestamp is later than the current time.".into());
    }
    // Only the fields needed to show usage are retained.
    let plan = plan.map(|name| name.trim().to_owned()).filter(|name| {
        !name.is_empty() && name.chars().count() <= 40 && !name.chars().any(char::is_control)
    });
    Ok(Snapshot {
        plan,
        captured_at,
        imported_at: now,
        windows,
    })
}

#[tauri::command]
pub(super) fn ai_usage_state(store: State<'_, Mutex<Store>>) -> Result<AiUsage, String> {
    Ok(store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .data
        .ai_usage
        .clone())
}

#[tauri::command]
pub(super) fn import_ai_usage(
    store: State<'_, Mutex<Store>>,
    provider: Provider,
    raw: String,
) -> Result<AiUsage, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "Check your computer clock.")?
        .as_secs();
    let snapshot = read_snapshot(provider, &raw, now)?;
    let saved = store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            *data.ai_usage.slot(provider) = Some(snapshot);
            Ok(())
        })?;
    Ok(saved.ai_usage)
}

#[tauri::command]
pub(super) fn clear_ai_usage(
    store: State<'_, Mutex<Store>>,
    provider: Provider,
) -> Result<AiUsage, String> {
    let saved = store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            *data.ai_usage.slot(provider) = None;
            Ok(())
        })?;
    Ok(saved.ai_usage)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_provider_windows_without_extra_fields() {
        let codex = read_snapshot(
            Provider::Codex,
            r#"{"result":{"rateLimits":{"planType":"plus","primary":{"usedPercent":24.5,"windowDurationMins":300,"resetsAt":1795132800}}}}"#,
            1795122800,
        ).unwrap();
        assert_eq!(codex.plan.as_deref(), Some("plus"));
        assert_eq!(codex.windows[0].used_percent, 24.5);
        assert_eq!(codex.windows[0].window_minutes, 300);

        let claude = read_snapshot(
            Provider::Claude,
            r#"{"five_hour":{"utilization":91,"resets_at":"2026-11-21T00:00:00Z"},"seven_day_sonnet":null,"unrelated":"unused"}"#,
            1795122800,
        ).unwrap();
        assert_eq!(claude.windows.len(), 1);
        assert!(claude.windows[0].resets_at.is_some());
        assert!(!serde_json::to_string(&claude)
            .unwrap()
            .contains("unrelated"));
    }

    #[test]
    fn rejects_out_of_range_and_wrong_provider() {
        let raw = r#"{"five_hour":{"utilization":117,"resets_at":null}}"#;
        assert!(read_snapshot(Provider::Claude, raw, 1795122800).is_err());
        assert!(read_snapshot(Provider::Codex, raw, 1795122800).is_err());
    }
}
