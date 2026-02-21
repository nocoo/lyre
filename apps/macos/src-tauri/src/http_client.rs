//! HTTP client for communicating with the Lyre web app.
//!
//! Uses `reqwest` with `rustls-tls` to avoid OpenSSL dependency.
//! The primary operation is `test_connection` which calls `GET /api/live`
//! with a Bearer token and verifies the response.

use reqwest::header::{HeaderMap, AUTHORIZATION};
use serde::Deserialize;

/// Response from the `/api/live` endpoint.
#[derive(Debug, Deserialize)]
struct LiveResponse {
    status: String,
    #[allow(dead_code)]
    version: Option<String>,
}

/// Test the connection to a Lyre web server.
///
/// Calls `GET <server_url>/api/live` with a Bearer token.
/// Returns `Ok(())` if the server responds with `{ "status": "ok" }`.
pub async fn test_connection(server_url: &str, token: &str) -> Result<(), String> {
    let url = normalize_url(server_url);
    let endpoint = format!("{url}/api/live");

    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        format!("Bearer {token}")
            .parse()
            .map_err(|e| format!("invalid token format: {e}"))?,
    );

    let client = reqwest::Client::builder()
        .default_headers(headers)
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;

    let response = client
        .get(&endpoint)
        .send()
        .await
        .map_err(|e| format!("connection failed: {e}"))?;

    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err("authentication failed — check your device token".to_string());
    }
    if !status.is_success() {
        return Err(format!("server returned HTTP {status}"));
    }

    let body: LiveResponse = response
        .json()
        .await
        .map_err(|e| format!("invalid server response: {e}"))?;

    if body.status != "ok" {
        return Err(format!(
            "unexpected status: {} (expected \"ok\")",
            body.status
        ));
    }

    Ok(())
}

/// Normalize a server URL: ensure no trailing slash, add https:// if missing.
fn normalize_url(url: &str) -> String {
    let url = url.trim().trim_end_matches('/');
    if !url.starts_with("http://") && !url.starts_with("https://") {
        format!("https://{url}")
    } else {
        url.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_url_trailing_slash() {
        assert_eq!(normalize_url("https://lyre.example.com/"), "https://lyre.example.com");
    }

    #[test]
    fn test_normalize_url_no_scheme() {
        assert_eq!(normalize_url("lyre.example.com"), "https://lyre.example.com");
    }

    #[test]
    fn test_normalize_url_http() {
        assert_eq!(normalize_url("http://localhost:7025"), "http://localhost:7025");
    }

    #[test]
    fn test_normalize_url_whitespace() {
        assert_eq!(normalize_url("  https://lyre.dev/  "), "https://lyre.dev");
    }

    #[test]
    fn test_normalize_url_already_clean() {
        assert_eq!(normalize_url("https://lyre.dev"), "https://lyre.dev");
    }
}
