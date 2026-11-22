# WFS Notch continuation after the v0.44.0 calendar wall-time batch

Start from the latest verified `main`. Follow [tracker #5](https://github.com/wawanwfs/WFS-Notch/issues/5). Do not use an old documentation branch as the source baseline and never force-push.

## Carried-forward behavior

- Task completion undo restores the exact prior occurrence and snooze when the task state has not changed. Completion history retention is local and independent from notification reservations.
- Calendar exact UTC/all-day shifts and source wall-time moves are distinct. Wall-time moves use the imported TZID or the saved floating IANA zone, preserve elapsed duration, keep a gap row at its original time and choose the earlier instant for an overlap. Only saved rows move. Do not regenerate recurrence, override entries or cancellations and keep unsupported ICS range operations rejected.
- Fixed 38-category feature coverage is **28.9%**. Browser UI and CI are not Windows desktop or Poni 1.5.0 parity evidence. Assets remain original WFS.

## Next implementation and verification batch

1. Run the [native Windows 10/11 matrix](WINDOWS_PARITY_ACCEPTANCE.md) using exact-commit installer and portable outputs. Capture observed display/DPI, fullscreen/RDP, selected media session, Narrator, toast opt-in, calendar DST and real installer upgrade behavior. Record unsigned build status and hashes separately.
2. Audit the same 16 modules across empty, loading and error states, keyboard access, text contrast and narrow display/DPI. Extend the 64-view browser screenshot matrix with deterministic UI fixtures. Keep comparative reference results separate from WFS-only evidence and call out deliberate design differences.
3. Continue a bounded local Shelf and consented read-only device integration as isolated changes. Preserve local storage limits, explicit permission/error state, and no tunnel or remote API.
4. Verify exact PR and post-merge CI, Rust/Clippy/format, browser checks and package SHA-256. Keep the tracker open while physical verification and reference comparison are missing.
