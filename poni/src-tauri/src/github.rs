use super::{bookmarks::open_in_default_browser, Store};
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use std::{sync::Mutex, time::Duration};
use tauri::State;

#[derive(Deserialize)]
struct SearchResponse {
    total_count: u64,
    items: Vec<SearchItem>,
    incomplete_results: bool,
}

#[derive(Deserialize)]
struct SearchItem {
    repository_url: String,
    title: String,
    number: u64,
    user: Option<GitHubUser>,
    updated_at: String,
    comments: u64,
    #[serde(default)]
    draft: bool,
}

#[derive(Deserialize)]
struct GitHubUser {
    login: String,
}

#[derive(Serialize)]
struct PullRequest {
    owner: String,
    repo: String,
    title: String,
    number: u64,
    author: Option<String>,
    updated_at: String,
    comments: u64,
    draft: bool,
}

#[derive(Serialize)]
struct PullRequestGroup {
    total: u64,
    items: Vec<PullRequest>,
    incomplete: bool,
    error: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct GitHubInbox {
    review: PullRequestGroup,
    mine: PullRequestGroup,
}

fn valid_login(login: &str) -> bool {
    !login.is_empty()
        && login.len() <= 39
        && login.starts_with(|character: char| character.is_ascii_alphanumeric())
        && login.ends_with(|character: char| character.is_ascii_alphanumeric())
        && !login.contains("--")
        && login
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn valid_repo(repo: &str) -> bool {
    !repo.is_empty()
        && !matches!(repo, "." | "..")
        && repo.len() <= 100
        && repo
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_.-".contains(&byte))
}

fn pull_request_url(owner: &str, repo: &str, number: u64) -> Result<Url, String> {
    if !valid_login(owner) || !valid_repo(repo) || number == 0 {
        return Err("Invalid pull request".into());
    }
    Url::parse(&format!("https://github.com/{owner}/{repo}/pull/{number}"))
        .map_err(|_| "Invalid pull request".into())
}

fn convert_item(item: SearchItem) -> Option<PullRequest> {
    let path = item
        .repository_url
        .strip_prefix("https://api.github.com/repos/")?;
    let (owner, repo) = path.split_once('/')?;
    if !valid_login(owner) || !valid_repo(repo) || item.number == 0 {
        return None;
    }
    Some(PullRequest {
        owner: owner.to_owned(),
        repo: repo.to_owned(),
        title: item.title,
        number: item.number,
        author: item.user.map(|user| user.login),
        updated_at: item.updated_at,
        comments: item.comments,
        draft: item.draft,
    })
}

async fn search(client: &Client, qualifier: &str, login: &str) -> Result<PullRequestGroup, String> {
    let query = format!("is:pr is:open {qualifier}:{login}");
    let response = client
        .get("https://api.github.com/search/issues")
        .query(&[
            ("q", query.as_str()),
            ("per_page", "20"),
            ("sort", "updated"),
            ("order", "desc"),
        ])
        .send()
        .await
        .map_err(|_| "Could not reach GitHub. Try again later.")?;
    match response.status() {
        StatusCode::FORBIDDEN | StatusCode::TOO_MANY_REQUESTS => {
            return Err("GitHub declined the public search. If its rate limit was reached, try again later.".into());
        }
        StatusCode::UNPROCESSABLE_ENTITY => {
            return Err("GitHub could not search this account. Check the username.".into());
        }
        status if !status.is_success() => {
            return Err(format!("GitHub search failed (HTTP {})", status.as_u16()));
        }
        _ => {}
    }
    let result: SearchResponse = response
        .json()
        .await
        .map_err(|_| "GitHub sent an unexpected response")?;
    Ok(PullRequestGroup {
        total: result.total_count,
        items: result.items.into_iter().filter_map(convert_item).collect(),
        incomplete: result.incomplete_results,
        error: None,
    })
}

async fn group(client: &Client, qualifier: &str, login: &str) -> PullRequestGroup {
    search(client, qualifier, login)
        .await
        .unwrap_or_else(|error| PullRequestGroup {
            total: 0,
            items: Vec::new(),
            incomplete: false,
            error: Some(error),
        })
}

fn saved_login(store: &Mutex<Store>) -> Result<Option<String>, String> {
    Ok(store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .data
        .github_login
        .clone())
}

#[tauri::command]
pub(crate) fn github_login(store: State<'_, Mutex<Store>>) -> Result<Option<String>, String> {
    saved_login(&store)
}

#[tauri::command]
pub(crate) fn save_github_login(
    store: State<'_, Mutex<Store>>,
    login: String,
) -> Result<Option<String>, String> {
    let login = login.trim();
    if !login.is_empty() && !valid_login(login) {
        return Err("Enter a valid GitHub username".into());
    }
    let state = store
        .lock()
        .map_err(|_| "Storage unavailable")?
        .update(|data| {
            data.github_login = (!login.is_empty()).then(|| login.to_owned());
            Ok(())
        })?;
    Ok(state.github_login)
}

#[tauri::command]
pub(crate) async fn refresh_github_inbox(
    store: State<'_, Mutex<Store>>,
) -> Result<GitHubInbox, String> {
    let login = saved_login(&store)?
        .filter(|login| valid_login(login))
        .ok_or("Enter a GitHub username first")?;
    let client = Client::builder()
        .user_agent("Poni-Rebuild/0.1")
        .default_headers({
            let mut headers = reqwest::header::HeaderMap::new();
            headers.insert(
                reqwest::header::ACCEPT,
                reqwest::header::HeaderValue::from_static("application/vnd.github+json"),
            );
            headers
        })
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|_| "Could not initialize the GitHub connection")?;
    // Sequential requests keep the small unauthenticated allowance predictable.
    let review = group(&client, "review-requested", &login).await;
    let mine = group(&client, "author", &login).await;
    Ok(GitHubInbox { review, mine })
}

#[tauri::command]
pub(crate) fn open_github_pull_request(
    owner: String,
    repo: String,
    number: u64,
) -> Result<(), String> {
    open_in_default_browser(pull_request_url(&owner, &repo, number)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constructs_only_github_pull_request_links() {
        let url = pull_request_url("octo-coder", "example.repo", 25).unwrap();
        assert_eq!(
            url.as_str(),
            "https://github.com/octo-coder/example.repo/pull/25"
        );
        assert!(pull_request_url("anything@evil.example", "repo", 1).is_err());
        assert!(pull_request_url("owner", "..", 1).is_err());
        assert!(pull_request_url("owner", "repo/path", 1).is_err());
        assert!(pull_request_url("owner", "repo", 0).is_err());
        assert!(!valid_login("name is:closed"));
    }
}
