use super::{AppData, CalendarEvent, EventRepeat, Store};
use chrono::{Local, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;
use serde::Serialize;
use std::{
    collections::{BTreeMap, HashSet},
    sync::Mutex,
};
use tauri::State;
use uuid::Uuid;

const MAX_FILE_BYTES: usize = 2 * 1024 * 1024;
const MAX_FILE_EVENTS: usize = 2_000;
const MAX_STORED_EVENTS: usize = 5_000;

#[derive(Default, Serialize)]
struct ImportSummary {
    imported: usize,
    duplicates: usize,
    skipped: usize,
    reasons: BTreeMap<&'static str, usize>,
}

impl ImportSummary {
    fn skip(&mut self, reason: &'static str) {
        self.skipped += 1;
        *self.reasons.entry(reason).or_default() += 1;
    }
}

#[derive(Serialize)]
pub(super) struct IcsImportResult {
    data: AppData,
    summary: ImportSummary,
}

#[tauri::command]
pub(super) fn import_calendar_ics(
    store: State<'_, Mutex<Store>>,
    text: String,
) -> Result<IcsImportResult, String> {
    let (events, mut summary) = read_ics(&text)?;
    let mut store = store.lock().map_err(|_| "Storage unavailable")?;
    let additions = select_new_events(&store.data.calendar_events, events, &mut summary);
    let data = if additions.is_empty() {
        store.data.clone()
    } else {
        store.update(move |data| {
            data.calendar_events.extend(additions);
            Ok(())
        })?
    };
    Ok(IcsImportResult { data, summary })
}

fn select_new_events(
    existing: &[CalendarEvent],
    events: Vec<CalendarEvent>,
    summary: &mut ImportSummary,
) -> Vec<CalendarEvent> {
    let mut seen: HashSet<_> = existing
        .iter()
        .filter(|event| matches!(event.repeat, EventRepeat::None))
        .map(event_identity)
        .collect();
    let available = MAX_STORED_EVENTS.saturating_sub(existing.len());
    let mut additions = Vec::new();

    for event in events {
        let identity = event_identity(&event);
        if seen.contains(&identity) {
            summary.duplicates += 1;
        } else if additions.len() >= available {
            summary.skip("Calendar storage limit reached");
        } else {
            seen.insert(identity);
            additions.push(event);
        }
    }

    summary.imported = additions.len();
    additions
}

fn event_identity(event: &CalendarEvent) -> (String, u64, u32, String) {
    (
        event.title.clone(),
        event.start_ms,
        event.duration_minutes,
        event.location.clone(),
    )
}

type Property<'a> = (&'a str, &'a str);

#[derive(Default)]
struct RawEvent<'a> {
    start: Option<Property<'a>>,
    end: Option<Property<'a>>,
    duration: Option<Property<'a>>,
    title: Option<Property<'a>>,
    location: Option<Property<'a>>,
    unsupported_recurrence: bool,
    cancelled: bool,
    repeated_property: bool,
}

impl<'a> RawEvent<'a> {
    fn add(&mut self, header: &'a str, value: &'a str) {
        let name = header.split(';').next().unwrap_or_default();
        let field = match name.to_ascii_uppercase().as_str() {
            "DTSTART" => &mut self.start,
            "DTEND" => &mut self.end,
            "DURATION" => &mut self.duration,
            "SUMMARY" => &mut self.title,
            "LOCATION" => &mut self.location,
            "RRULE" | "RDATE" | "EXRULE" | "EXDATE" | "RECURRENCE-ID" => {
                self.unsupported_recurrence = true;
                return;
            }
            "STATUS" if value.eq_ignore_ascii_case("CANCELLED") => {
                self.cancelled = true;
                return;
            }
            _ => return,
        };
        self.repeated_property |= field.replace((header, value)).is_some();
    }

    fn event(self) -> Result<CalendarEvent, &'static str> {
        if self.cancelled {
            return Err("Cancelled events");
        }
        if self.unsupported_recurrence {
            return Err("Recurring events and occurrence exceptions");
        }
        if self.repeated_property {
            return Err("Repeated event properties");
        }

        let start_ms = datetime(self.start.ok_or("Missing event start")?)?;
        let length = match (self.end, self.duration) {
            (Some(end), None) => datetime(end)?
                .checked_sub(start_ms)
                .filter(|duration| duration % 60_000 == 0)
                .map(|duration| duration / 60_000),
            (None, Some((_, duration))) => duration_minutes(duration),
            _ => None,
        };
        let duration_minutes = length
            .filter(|minutes| (1..=1440).contains(minutes))
            .ok_or("Missing or unsupported duration (needs 1–1,440 whole minutes)")?
            as u32;

        let title = self
            .title
            .map(|(_, value)| unescape_text(value))
            .filter(|text| !text.trim().is_empty())
            .ok_or("Missing event title")?;
        let location = self
            .location
            .map_or_else(String::new, |(_, value)| unescape_text(value));
        let mut event = CalendarEvent {
            id: Uuid::new_v4(),
            title,
            start_ms,
            duration_minutes,
            location,
            repeat: EventRepeat::None,
        };
        event
            .validate()
            .map_err(|_| "Title or location exceeds the Calendar limit")?;
        Ok(event)
    }
}

fn read_ics(text: &str) -> Result<(Vec<CalendarEvent>, ImportSummary), String> {
    if text.len() > MAX_FILE_BYTES {
        return Err("Choose an .ics file of 2 MB or less".into());
    }
    let lines = unfold(text)?;
    let mut components: Vec<&str> = Vec::new();
    let mut raw_event = None;
    let mut calendar_events: Vec<RawEvent<'_>> = Vec::new();
    let mut cancel_calendar = false;
    let mut calendar_seen = false;
    let mut seen_events = 0;
    let mut result = Vec::new();
    let mut summary = ImportSummary::default();

    for line in &lines {
        let Some((header, value)) = split_unquoted_once(line, ':') else {
            return Err("The .ics file contains an invalid content line".into());
        };
        if header.eq_ignore_ascii_case("BEGIN") {
            if components.len() >= 32
                || !value
                    .bytes()
                    .all(|ch| ch.is_ascii_alphanumeric() || ch == b'-')
                || value.is_empty()
            {
                return Err("The .ics file contains an invalid calendar structure".into());
            }
            if components.is_empty() && !value.eq_ignore_ascii_case("VCALENDAR") {
                return Err("The .ics file must begin with VCALENDAR".into());
            }
            if !components.is_empty() && value.eq_ignore_ascii_case("VCALENDAR") {
                return Err("The .ics file contains a nested calendar".into());
            }
            if value.eq_ignore_ascii_case("VEVENT") {
                if components.len() != 1 {
                    return Err("An event must be a direct member of a calendar".into());
                }
                seen_events += 1;
                if seen_events > MAX_FILE_EVENTS {
                    return Err("An .ics file can contain at most 2,000 events".into());
                }
                raw_event = Some(RawEvent::default());
            }
            components.push(value);
        } else if header.eq_ignore_ascii_case("END") {
            let component = components
                .pop()
                .ok_or("The .ics file has an unexpected END")?;
            if !component.eq_ignore_ascii_case(value) {
                return Err("Calendar components do not close in the expected order".into());
            }
            if top_is(&components, "VCALENDAR") && component.eq_ignore_ascii_case("VEVENT") {
                calendar_events.push(raw_event.take().ok_or("An event is missing its start")?);
            }
            if components.is_empty() {
                calendar_seen = true;
                for raw_event in calendar_events.drain(..) {
                    if cancel_calendar {
                        summary.skip("Cancelled events");
                        continue;
                    }
                    match raw_event.event() {
                        Ok(event) => result.push(event),
                        Err(reason) => summary.skip(reason),
                    }
                }
                cancel_calendar = false;
            }
        } else if components.is_empty() {
            return Err("The .ics file must begin with VCALENDAR".into());
        } else if top_is(&components, "VEVENT") && components.len() == 2 {
            if let Some(event) = raw_event.as_mut() {
                event.add(header, value);
            }
        } else if components.len() == 1 && header.eq_ignore_ascii_case("METHOD") {
            cancel_calendar |= value.eq_ignore_ascii_case("CANCEL");
        }
    }
    if !calendar_seen || !components.is_empty() {
        return Err("The .ics file does not contain a complete calendar".into());
    }
    Ok((result, summary))
}

fn top_is(components: &[&str], name: &str) -> bool {
    components
        .last()
        .is_some_and(|component| component.eq_ignore_ascii_case(name))
}

fn unfold(text: &str) -> Result<Vec<String>, String> {
    let mut lines: Vec<String> = Vec::new();
    for line in text.trim_start_matches('\u{feff}').lines() {
        if let Some(rest) = line.strip_prefix(' ').or_else(|| line.strip_prefix('\t')) {
            lines
                .last_mut()
                .ok_or("The .ics file has a misplaced folded line")?
                .push_str(rest);
        } else if !line.is_empty() {
            lines.push(line.to_owned());
        }
    }
    Ok(lines)
}

fn split_unquoted_once(text: &str, delimiter: char) -> Option<(&str, &str)> {
    let mut quoted = false;
    for (index, ch) in text.char_indices() {
        if ch == '"' {
            quoted = !quoted;
        } else if ch == delimiter && !quoted {
            return Some((&text[..index], &text[index + ch.len_utf8()..]));
        }
    }
    None
}

fn datetime((header, value): Property<'_>) -> Result<u64, &'static str> {
    let mut timezone = None;
    let mut remaining = header.split_once(';').map(|(_, params)| params);
    while let Some(params) = remaining {
        let (param, rest) = split_unquoted_once(params, ';')
            .map_or((params, None), |(head, tail)| (head, Some(tail)));
        remaining = rest;
        let (key, raw) = param.split_once('=').ok_or("Invalid event time")?;
        let raw = raw
            .strip_prefix('"')
            .and_then(|value| value.strip_suffix('"'))
            .unwrap_or(raw);
        if key.eq_ignore_ascii_case("TZID") {
            if timezone.replace(raw).is_some() {
                return Err("Invalid event time");
            }
        } else if key.eq_ignore_ascii_case("VALUE") {
            if raw.eq_ignore_ascii_case("DATE") {
                return Err("All-day events");
            }
            if !raw.eq_ignore_ascii_case("DATE-TIME") {
                return Err("Unsupported event date type");
            }
        }
    }
    if value.len() == 8 && value.bytes().all(|b| b.is_ascii_digit()) {
        return Err("All-day events");
    }
    let utc_time = value.strip_suffix('Z');
    let wall_time = NaiveDateTime::parse_from_str(utc_time.unwrap_or(value), "%Y%m%dT%H%M%S")
        .map_err(|_| "Invalid event time")?;
    let timestamp = match (utc_time.is_some(), timezone) {
        (true, None) => Utc.from_utc_datetime(&wall_time).timestamp_millis(),
        (true, Some(_)) => return Err("An event time has both UTC and a time-zone identifier"),
        (false, Some(zone)) => zone
            .parse::<Tz>()
            .map_err(|_| "Unknown time zones")?
            .from_local_datetime(&wall_time)
            .single()
            .ok_or("Ambiguous or nonexistent local times")?
            .timestamp_millis(),
        (false, None) => Local
            .from_local_datetime(&wall_time)
            .single()
            .ok_or("Ambiguous or nonexistent local times")?
            .timestamp_millis(),
    };
    u64::try_from(timestamp).map_err(|_| "Dates before 1970")
}

fn duration_minutes(value: &str) -> Option<u64> {
    fn amount<'a>(value: &mut &'a str, unit: u8) -> Option<u64> {
        let digits = value.bytes().take_while(u8::is_ascii_digit).count();
        if digits == 0 || value.as_bytes().get(digits).copied() != Some(unit) {
            return None;
        }
        let amount = value[..digits].parse::<u64>().ok()?;
        *value = &value[digits + 1..];
        Some(amount)
    }

    // A nominal day or week can cross a DST change. CalendarEvent records elapsed
    // minutes, so accept time-only lengths.
    let mut time = value
        .strip_prefix('+')
        .unwrap_or(value)
        .strip_prefix("PT")?;
    let hours = amount(&mut time, b'H').unwrap_or(0);
    let minutes = amount(&mut time, b'M').unwrap_or(0);
    let seconds = amount(&mut time, b'S').unwrap_or(0);
    if !time.is_empty() || seconds % 60 != 0 {
        return None;
    }
    hours
        .checked_mul(60)?
        .checked_add(minutes)?
        .checked_add(seconds / 60)
}

fn unescape_text(value: &str) -> String {
    let mut chars = value.chars();
    let mut output = String::with_capacity(value.len());
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            output.push(ch);
            continue;
        }
        match chars.next() {
            Some('n' | 'N') => output.push('\n'),
            Some(escaped @ ('\\' | ',' | ';')) => output.push(escaped),
            Some(other) => {
                output.push('\\');
                output.push(other);
            }
            None => output.push('\\'),
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_folded_text_and_preserves_time_zone_and_duration() {
        let calendar = concat!(
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\n",
            "UID:meeting\r\nSUMMARY:Agenda\\, one\\nSecond\r\n  line\r\n",
            "DTSTART;TZID=\"America/New_York\":20260115T120000\r\n",
            "DTEND:20260115T173000Z\r\nLOCATION:Room\\; A\r\n",
            "BEGIN:VALARM\r\nDESCRIPTION:This is not the event title\r\nEND:VALARM\r\n",
            "END:VEVENT\r\nEND:VCALENDAR\r\n"
        );
        let (events, summary) = read_ics(calendar).unwrap();
        assert_eq!(summary.skipped, 0);
        assert_eq!(events.len(), 1);
        let event = &events[0];
        assert_eq!(event.title, "Agenda, one\nSecond line");
        assert_eq!(event.location, "Room; A");
        assert_eq!(event.duration_minutes, 30);
        assert_eq!(
            event.start_ms,
            Utc.with_ymd_and_hms(2026, 1, 15, 17, 0, 0)
                .unwrap()
                .timestamp_millis() as u64
        );
        assert_eq!(duration_minutes("PT1H30M"), Some(90));
        assert_eq!(duration_minutes("PT24H"), Some(1440));
        assert_eq!(duration_minutes("P1D"), None);
        assert_eq!(duration_minutes("PT2M30S"), None);
    }

    #[test]
    fn reports_unmodelled_events_without_turning_them_into_single_appointments() {
        let calendar = concat!(
            "BEGIN:VCALENDAR\n",
            "BEGIN:VEVENT\nSUMMARY:All day\nDTSTART;VALUE=DATE:20260115\nDURATION:P1D\nEND:VEVENT\n",
            "BEGIN:VEVENT\nSUMMARY:Weekly\nDTSTART:20260115T120000Z\nRRULE:FREQ=WEEKLY\nDURATION:PT1H\nEND:VEVENT\n",
            "BEGIN:VEVENT\nSUMMARY:From Outlook\nDTSTART;TZID=Unsupported:20260115T120000\nDURATION:PT1H\nEND:VEVENT\n",
            "BEGIN:VEVENT\nSUMMARY:Cancelled\nDTSTART:20260115T120000Z\nDURATION:PT1H\nEND:VEVENT\nMETHOD:CANCEL\n",
            "END:VCALENDAR\n",
        );
        let (events, summary) = read_ics(calendar).unwrap();
        assert!(events.is_empty());
        assert_eq!(summary.skipped, 4);
        assert_eq!(summary.reasons.get("Cancelled events"), Some(&4));
        let local = calendar.replace("METHOD:CANCEL\n", "");
        let (events, summary) = read_ics(&local).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(summary.skipped, 3);
        assert_eq!(summary.reasons.get("All-day events"), Some(&1));
        assert_eq!(
            summary
                .reasons
                .get("Recurring events and occurrence exceptions"),
            Some(&1)
        );
        assert_eq!(summary.reasons.get("Unknown time zones"), Some(&1));
    }

    #[test]
    fn catches_invalid_structure_and_size_limits() {
        assert!(read_ics("BEGIN:VCALENDAR\nBEGIN:VEVENT\nEND:VCALENDAR").is_err());
        assert!(read_ics(&"x".repeat(MAX_FILE_BYTES + 1)).is_err());
    }

    #[test]
    fn reimport_leaves_existing_events_unchanged_and_discards_same_file_duplicates() {
        let details =
            "BEGIN:VEVENT\nDTSTART:20260115T120000Z\nDURATION:PT1H\nSUMMARY:Review\nEND:VEVENT";
        let calendar = format!("BEGIN:VCALENDAR\n{details}\n{details}\nEND:VCALENDAR");
        let (events, mut first_summary) = read_ics(&calendar).unwrap();
        let saved = select_new_events(&[], events, &mut first_summary);
        assert_eq!(saved.len(), 1);
        assert_eq!(first_summary.duplicates, 1);
        let (events, mut second_summary) = read_ics(&calendar).unwrap();
        assert!(select_new_events(&saved, events, &mut second_summary).is_empty());
        assert_eq!(second_summary.duplicates, 2);
    }
}
