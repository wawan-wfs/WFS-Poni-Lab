use super::bookmarks::open_in_default_browser;
use reqwest::Url;

#[tauri::command]
pub(crate) fn open_support_link(destination: String) -> Result<(), String> {
    let address = match destination.as_str() {
        "paypal" => "https://paypal.me/bosdigital",
        "github" => "https://github.com/liimalim/Poni",
        _ => return Err("Unknown Poni support link".into()),
    };
    open_in_default_browser(Url::parse(address).expect("valid support address"))
}
