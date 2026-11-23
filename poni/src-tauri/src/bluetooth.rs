use serde::Serialize;

#[derive(Serialize)]
pub(super) struct BluetoothSnapshot {
    supported: bool,
    adapter_present: bool,
    devices: Vec<BluetoothDevice>,
}

#[derive(Serialize)]
struct BluetoothDevice {
    name: String,
    connected: Option<bool>,
    paired: bool,
    kind: &'static str,
}

#[tauri::command]
pub(super) async fn bluetooth_devices() -> Result<BluetoothSnapshot, String> {
    tauri::async_runtime::spawn_blocking(read_snapshot)
        .await
        .map_err(|_| "Bluetooth device lookup did not finish".to_owned())?
}

#[cfg(not(windows))]
fn read_snapshot() -> Result<BluetoothSnapshot, String> {
    Ok(BluetoothSnapshot {
        supported: false,
        adapter_present: false,
        devices: Vec::new(),
    })
}

#[cfg(windows)]
fn read_snapshot() -> Result<BluetoothSnapshot, String> {
    use std::{collections::BTreeMap, mem::size_of, ptr::null_mut};
    use windows_sys::Win32::{
        Devices::Bluetooth::{
            BluetoothFindDeviceClose, BluetoothFindFirstDevice, BluetoothFindFirstRadio,
            BluetoothFindNextDevice, BluetoothFindRadioClose, BLUETOOTH_DEVICE_INFO,
            BLUETOOTH_DEVICE_SEARCH_PARAMS, BLUETOOTH_FIND_RADIO_PARAMS, HBLUETOOTH_DEVICE_FIND,
        },
        Foundation::{
            CloseHandle, GetLastError, ERROR_FILE_NOT_FOUND, ERROR_NO_MORE_FILES,
            ERROR_NO_MORE_ITEMS, ERROR_SERVICE_NOT_ACTIVE,
        },
    };

    // Only check for a local radio. Device discovery is deliberately disabled below.
    let radio_params = BLUETOOTH_FIND_RADIO_PARAMS {
        dwSize: size_of::<BLUETOOTH_FIND_RADIO_PARAMS>() as u32,
    };
    let mut radio = null_mut();
    let radios = unsafe { BluetoothFindFirstRadio(&radio_params, &mut radio) };
    if radios.is_null() {
        let code = unsafe { GetLastError() };
        if matches!(
            code,
            ERROR_FILE_NOT_FOUND
                | ERROR_NO_MORE_FILES
                | ERROR_NO_MORE_ITEMS
                | ERROR_SERVICE_NOT_ACTIVE
        ) {
            return Ok(snapshot_with_devices(false, BTreeMap::new()));
        }
        return Err(format!(
            "Could not check for Bluetooth adapters (Windows error {code})"
        ));
    }
    unsafe {
        CloseHandle(radio);
        BluetoothFindRadioClose(radios);
    }

    struct DeviceSearch(HBLUETOOTH_DEVICE_FIND);
    impl Drop for DeviceSearch {
        fn drop(&mut self) {
            unsafe { BluetoothFindDeviceClose(self.0) };
        }
    }

    let params = BLUETOOTH_DEVICE_SEARCH_PARAMS {
        dwSize: size_of::<BLUETOOTH_DEVICE_SEARCH_PARAMS>() as u32,
        fReturnAuthenticated: 1,
        fReturnRemembered: 1,
        fReturnUnknown: 0,
        fReturnConnected: 1,
        fIssueInquiry: 0,
        cTimeoutMultiplier: 0,
        hRadio: null_mut(), // Use the remembered list from all local adapters.
    };
    let mut info = BLUETOOTH_DEVICE_INFO {
        dwSize: size_of::<BLUETOOTH_DEVICE_INFO>() as u32,
        ..Default::default()
    };
    let search = unsafe { BluetoothFindFirstDevice(&params, &mut info) };
    let mut by_address: BTreeMap<u64, BluetoothDevice> = BTreeMap::new();
    if search.is_null() {
        let code = unsafe { GetLastError() };
        if !matches!(code, ERROR_NO_MORE_ITEMS | ERROR_NO_MORE_FILES) {
            return Err(format!(
                "Could not read Bluetooth devices (Windows error {code})"
            ));
        }
    } else {
        let search = DeviceSearch(search);
        loop {
            let paired = info.fAuthenticated != 0;
            if paired || info.fRemembered != 0 {
                // Use the address only to deduplicate entries returned for multiple radios.
                let address = unsafe { info.Address.Anonymous.ullLong };
                let length = info
                    .szName
                    .iter()
                    .position(|x| *x == 0)
                    .unwrap_or(info.szName.len());
                let name = String::from_utf16_lossy(&info.szName[..length]);
                let name = name.trim();
                let connected = info.fConnected != 0;
                let kind = match (info.ulClassofDevice >> 8) & 0x1f {
                    1 => "Computer",
                    2 => "Phone",
                    4 => "Audio or video",
                    5 => "Peripheral",
                    6 => "Imaging",
                    7 => "Wearable",
                    8 => "Toy",
                    9 => "Health device",
                    _ => "Bluetooth device",
                };
                let device = by_address
                    .entry(address)
                    .or_insert_with(|| BluetoothDevice {
                        name: name.to_owned(),
                        connected: Some(connected),
                        paired,
                        kind,
                    });
                device.connected = Some(device.connected == Some(true) || connected);
                device.paired |= paired;
                if device.name.is_empty() {
                    device.name = name.to_owned();
                }
            }
            if unsafe { BluetoothFindNextDevice(search.0, &mut info) } == 0 {
                let code = unsafe { GetLastError() };
                if !matches!(code, ERROR_NO_MORE_ITEMS | ERROR_NO_MORE_FILES) {
                    return Err(format!(
                        "Could not finish reading Bluetooth devices (Windows error {code})"
                    ));
                }
                break;
            }
        }
    }
    Ok(snapshot_with_devices(true, by_address))
}

#[cfg(windows)]
fn snapshot_with_devices(
    classic_adapter_present: bool,
    mut classic: std::collections::BTreeMap<u64, BluetoothDevice>,
) -> BluetoothSnapshot {
    let low_energy = read_low_energy().unwrap_or_default();
    let mut le_only = Vec::new();
    for (address, low_energy_device) in low_energy {
        let matching_name = || {
            if low_energy_device.name.is_empty() {
                return None;
            }
            let name = low_energy_device.name.to_lowercase();
            let mut matches = classic
                .iter()
                .filter(|(_, device)| device.name.to_lowercase() == name);
            let (&key, _) = matches.next()?;
            matches.next().is_none().then_some(key)
        };
        if let Some(key) = address.or_else(matching_name) {
            if let Some(saved_device) = classic.get_mut(&key) {
                saved_device.paired = true;
                saved_device.connected = saved_device.connected.max(low_energy_device.connected);
                if saved_device.name.is_empty() {
                    saved_device.name = low_energy_device.name;
                }
            } else {
                classic.insert(key, low_energy_device);
            }
        } else {
            le_only.push(low_energy_device);
        }
    }
    let mut devices: Vec<_> = classic.into_values().chain(le_only).collect();
    for device in &mut devices {
        if device.name.is_empty() {
            device.name = "Unnamed device".to_owned();
        }
    }
    devices.sort_by(|a, b| {
        b.connected
            .cmp(&a.connected)
            .then_with(|| a.name.cmp(&b.name))
    });
    BluetoothSnapshot {
        supported: true,
        adapter_present: classic_adapter_present || !devices.is_empty(),
        devices,
    }
}

#[cfg(windows)]
fn read_low_energy() -> windows::core::Result<Vec<(Option<u64>, BluetoothDevice)>> {
    use std::time::{Duration, Instant};
    use windows::{
        core::{Interface, HSTRING},
        Devices::{
            Bluetooth::BluetoothLEDevice,
            Enumeration::{DeviceInformation, DeviceInformationKind},
        },
        Foundation::IPropertyValue,
        Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
    };
    use windows_collections::IIterable;
    use windows_future::AsyncStatus;

    struct WinRtApartment;
    impl Drop for WinRtApartment {
        fn drop(&mut self) {
            unsafe { RoUninitialize() };
        }
    }

    unsafe { RoInitialize(RO_INIT_MULTITHREADED)? };
    let _apartment = WinRtApartment;
    let filter = BluetoothLEDevice::GetDeviceSelectorFromPairingState(true)?;
    let connected_key = HSTRING::from("System.Devices.Aep.IsConnected");
    let address_key = HSTRING::from("System.Devices.Aep.DeviceAddress");
    let properties: IIterable<HSTRING> = vec![connected_key.clone(), address_key.clone()].into();
    let query = DeviceInformation::FindAllAsyncWithKindAqsFilterAndAdditionalProperties(
        &filter,
        &properties,
        DeviceInformationKind::AssociationEndpoint,
    )?;
    let deadline = Instant::now() + Duration::from_millis(1500);
    while query.Status()? == AsyncStatus::Started {
        if Instant::now() >= deadline {
            let _ = query.Cancel();
            return Ok(Vec::new());
        }
        std::thread::sleep(Duration::from_millis(20));
    }

    let results = query.GetResults()?;
    let mut devices = Vec::new();
    for index in 0..results.Size()?.min(256) {
        let Ok(item) = results.GetAt(index) else {
            continue;
        };
        let Ok(properties) = item.Properties() else {
            continue;
        };
        let lookup = |key: &HSTRING| properties.Lookup(key).ok()?.cast::<IPropertyValue>().ok();
        let connected = lookup(&connected_key).and_then(|value| value.GetBoolean().ok());
        let address = lookup(&address_key)
            .and_then(|value| value.GetString().ok())
            .and_then(|address| parse_device_address(&address.to_string_lossy()));
        let name = item
            .Name()
            .map(|name| name.to_string_lossy())
            .unwrap_or_default();
        devices.push((
            address,
            BluetoothDevice {
                name: name.trim().to_owned(),
                connected,
                paired: true,
                kind: "Bluetooth LE device",
            },
        ));
    }
    Ok(devices)
}

#[cfg(any(windows, test))]
fn parse_device_address(address: &str) -> Option<u64> {
    let hex: String = address
        .chars()
        .filter(|&character| character != ':' && character != '-')
        .collect();
    if hex.len() != 12 {
        return None;
    }
    u64::from_str_radix(&hex, 16).ok()
}

#[cfg(test)]
mod tests {
    use super::parse_device_address;

    #[test]
    fn normalizes_winrt_addresses_for_classic_merge() {
        assert_eq!(
            parse_device_address("AB:CD:01:23:45:67"),
            Some(0xabcd01234567)
        );
        assert_eq!(
            parse_device_address("ab-cd-01-23-45-67"),
            Some(0xabcd01234567)
        );
        assert_eq!(parse_device_address("invalid"), None);
    }
}
