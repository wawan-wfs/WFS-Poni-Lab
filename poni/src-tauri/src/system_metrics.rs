use serde::Serialize;
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Default, Serialize)]
pub(super) struct Extras {
    disk_percent: Option<f64>,
    wifi_percent: Option<u32>,
    received_bits_per_second: Option<f64>,
    sent_bits_per_second: Option<f64>,
}

#[derive(Default)]
pub(super) struct Metrics {
    networks: sysinfo::Networks,
    last_network: Option<Instant>,
    last_storage: Option<Instant>,
    last_wifi: Option<Instant>,
    snapshot: Extras,
}

impl Metrics {
    pub(super) fn sample(&mut self, storage: bool, network: bool, wifi: bool) -> Extras {
        let now = Instant::now();
        if network
            && self
                .last_network
                .is_none_or(|last| now.duration_since(last) >= Duration::from_secs(1))
        {
            self.networks.refresh(true);
            if let Some(previous) = self.last_network.replace(now) {
                let (received, sent) =
                    self.networks
                        .iter()
                        .fold((0.0, 0.0), |(received, sent), (name, sample)| {
                            if name == "lo" || name.to_ascii_lowercase().contains("loopback") {
                                return (received, sent);
                            }
                            (
                                received + sample.received() as f64,
                                sent + sample.transmitted() as f64,
                            )
                        });
                let seconds = now.duration_since(previous).as_secs_f64();
                self.snapshot.received_bits_per_second = Some(received * 8.0 / seconds);
                self.snapshot.sent_bits_per_second = Some(sent * 8.0 / seconds);
            }
        }
        if storage
            && self
                .last_storage
                .is_none_or(|last| now.duration_since(last) >= Duration::from_secs(15))
        {
            self.snapshot.disk_percent = system_disk_usage();
            self.last_storage = Some(now);
        }
        if wifi
            && self
                .last_wifi
                .is_none_or(|last| now.duration_since(last) >= Duration::from_secs(15))
        {
            self.snapshot.wifi_percent = wifi_quality();
            self.last_wifi = Some(now);
        }
        self.snapshot
    }
}

#[cfg(not(windows))]
fn system_disk_usage() -> Option<f64> {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let disk = disks
        .iter()
        .find(|disk| disk.mount_point() == std::path::Path::new("/"))?;
    let total = disk.total_space();
    (total > 0).then(|| 100.0 * total.saturating_sub(disk.available_space()) as f64 / total as f64)
}

#[cfg(windows)]
fn system_disk_usage() -> Option<f64> {
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let root = std::env::var("SystemDrive").ok()?;
    let [letter, colon] = *root.as_bytes() else {
        return None;
    };
    if !letter.is_ascii_alphabetic() || colon != b':' {
        return None;
    }
    let path = [u16::from(letter), u16::from(colon), u16::from(b'\\'), 0];
    let mut total = 0;
    let mut free = 0;
    let valid =
        unsafe { GetDiskFreeSpaceExW(path.as_ptr(), std::ptr::null_mut(), &mut total, &mut free) }
            != 0;
    (valid && total > 0).then(|| 100.0 * total.saturating_sub(free) as f64 / total as f64)
}

#[cfg(not(windows))]
fn wifi_quality() -> Option<u32> {
    None
}

#[cfg(windows)]
fn wifi_quality() -> Option<u32> {
    use std::{
        ffi::c_void,
        mem::size_of,
        ptr::{addr_of, null, null_mut},
    };
    use windows_sys::Win32::{
        Foundation::HANDLE,
        NetworkManagement::WiFi::{
            wlan_interface_state_connected, wlan_intf_opcode_current_connection, WlanCloseHandle,
            WlanEnumInterfaces, WlanFreeMemory, WlanOpenHandle, WlanQueryInterface,
            WLAN_CONNECTION_ATTRIBUTES, WLAN_INTERFACE_INFO,
        },
    };

    struct Client(HANDLE);
    impl Drop for Client {
        fn drop(&mut self) {
            unsafe { WlanCloseHandle(self.0, null()) };
        }
    }
    struct Allocation(*const c_void);
    impl Drop for Allocation {
        fn drop(&mut self) {
            unsafe { WlanFreeMemory(self.0) };
        }
    }

    let mut handle = null_mut();
    let mut version = 0;
    if unsafe { WlanOpenHandle(2, null(), &mut version, &mut handle) } != 0 || handle.is_null() {
        return None;
    }
    let client = Client(handle);
    let mut list = null_mut();
    if unsafe { WlanEnumInterfaces(client.0, null(), &mut list) } != 0 || list.is_null() {
        return None;
    }
    let _list = Allocation(list.cast());
    // Win32 returns a variable-length array after its fixed header.
    let count = unsafe { (*list).dwNumberOfItems }.min(64) as usize;
    let first = unsafe { addr_of!((*list).InterfaceInfo).cast::<WLAN_INTERFACE_INFO>() };
    let interfaces = unsafe { std::slice::from_raw_parts(first, count) };
    interfaces
        .iter()
        .filter(|item| item.isState == wlan_interface_state_connected)
        .filter_map(|item| {
            let mut bytes = 0;
            let mut data = null_mut();
            let result = unsafe {
                WlanQueryInterface(
                    client.0,
                    &item.InterfaceGuid,
                    wlan_intf_opcode_current_connection,
                    null(),
                    &mut bytes,
                    &mut data,
                    null_mut(),
                )
            };
            if result != 0 || data.is_null() {
                return None;
            }
            let _data = Allocation(data);
            if (bytes as usize) < size_of::<WLAN_CONNECTION_ATTRIBUTES>() {
                return None;
            }
            let state = unsafe { &*data.cast::<WLAN_CONNECTION_ATTRIBUTES>() };
            (state.isState == wlan_interface_state_connected)
                .then_some(state.wlanAssociationAttributes.wlanSignalQuality.min(100))
        })
        .max()
}
