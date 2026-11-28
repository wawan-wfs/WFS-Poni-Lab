use crate::WeatherLocation;

#[tauri::command]
pub(super) async fn locate_weather(
    window: tauri::WebviewWindow,
) -> Result<WeatherLocation, String> {
    if window.label() != "settings" {
        return Err("Open Weather in Poni Settings to use your location".into());
    }
    #[cfg(windows)]
    {
        let (send, receive) = std::sync::mpsc::sync_channel(1);
        window
            .run_on_main_thread(move || {
                let _ = send.send(native::request_access());
            })
            .map_err(|_| "Could not open Windows Location access".to_owned())?;
        tauri::async_runtime::spawn_blocking(move || {
            let access = receive
                .recv_timeout(std::time::Duration::from_secs(5))
                .map_err(|_| {
                    "Could not check whether Windows allows location access".to_owned()
                })??;
            native::read_position(access)
        })
        .await
        .map_err(|_| "Windows Location lookup did not finish".to_owned())?
    }
    #[cfg(not(windows))]
    Err("Location lookup is available through Windows Location services".into())
}

#[cfg(windows)]
mod native {
    use super::WeatherLocation;
    use std::time::{Duration, Instant};
    use windows::{
        core::RuntimeType,
        Devices::Geolocation::{GeolocationAccessStatus, Geolocator},
        Foundation::TimeSpan,
        Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
    };
    use windows_future::{AsyncStatus, IAsyncOperation};

    pub(super) fn request_access() -> Result<IAsyncOperation<GeolocationAccessStatus>, String> {
        Geolocator::RequestAccessAsync().map_err(|_| {
            "Enable Location services and desktop app access in Windows Location settings".into()
        })
    }

    pub(super) fn read_position(
        access: IAsyncOperation<GeolocationAccessStatus>,
    ) -> Result<WeatherLocation, String> {
        struct Apartment;
        impl Drop for Apartment {
            fn drop(&mut self) {
                unsafe { RoUninitialize() }
            }
        }
        unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.map_err(|error| error.to_string())?;
        let _apartment = Apartment;
        if wait(&access, Duration::from_secs(30))? != GeolocationAccessStatus::Allowed {
            return Err(
                "Enable Location services and desktop app access in Windows Location settings"
                    .into(),
            );
        }
        let position = Geolocator::new()
            .and_then(|locator| {
                locator.GetGeopositionAsyncWithAgeAndTimeout(
                    TimeSpan {
                        Duration: 60 * 10_000_000,
                    },
                    TimeSpan {
                        Duration: 12 * 10_000_000,
                    },
                )
            })
            .map_err(|error| error.to_string())?;
        let point = wait(&position, Duration::from_secs(14))?
            .Coordinate()
            .and_then(|coordinate| coordinate.Point())
            .and_then(|point| point.Position())
            .map_err(|error| error.to_string())?;
        let location = WeatherLocation {
            name: "Current location".into(),
            country: None,
            admin1: None,
            latitude: point.Latitude,
            longitude: point.Longitude,
        };
        location.validate()?;
        Ok(location)
    }

    fn wait<T: RuntimeType + 'static>(
        operation: &IAsyncOperation<T>,
        limit: Duration,
    ) -> Result<T, String> {
        let end = Instant::now() + limit;
        while operation.Status().map_err(|error| error.to_string())? == AsyncStatus::Started {
            if Instant::now() >= end {
                let _ = operation.Cancel();
                return Err("Windows could not find the location in time".into());
            }
            std::thread::sleep(Duration::from_millis(60));
        }
        operation.GetResults().map_err(|error| error.to_string())
    }
}
