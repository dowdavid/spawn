use tauri::{AppHandle, Manager, WebviewUrl};
use tauri::webview::WebviewBuilder;

#[tauri::command]
pub fn create_child_webview(
    app: AppHandle,
    label: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    // Get the underlying Window (not WebviewWindow) which has add_child
    let window = app
        .windows()
        .into_values()
        .next()
        .ok_or("no window found")?;

    let webview_url: WebviewUrl = if url.starts_with("http://") || url.starts_with("https://") {
        WebviewUrl::External(url.parse().map_err(|e: url::ParseError| e.to_string())?)
    } else {
        WebviewUrl::App(url.into())
    };

    let builder = WebviewBuilder::new(&label, webview_url);

    let webview = window
        .add_child(
            builder,
            tauri::LogicalPosition::new(x, y),
            tauri::LogicalSize::new(width, height),
        )
        .map_err(|e: tauri::Error| e.to_string())?;

    // Hide immediately — frontend will show after confirming position
    webview.hide().map_err(|e: tauri::Error| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn set_child_webview_bounds(
    app: AppHandle,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let webview = app.get_webview(&label).ok_or("webview not found")?;
    webview
        .set_position(tauri::LogicalPosition::new(x, y))
        .map_err(|e: tauri::Error| e.to_string())?;
    webview
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|e: tauri::Error| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn show_child_webview(
    app: AppHandle,
    label: String,
) -> Result<(), String> {
    let webview = app.get_webview(&label).ok_or("webview not found")?;
    webview.show().map_err(|e: tauri::Error| e.to_string())
}

#[tauri::command]
pub fn hide_child_webview(
    app: AppHandle,
    label: String,
) -> Result<(), String> {
    let webview = app.get_webview(&label).ok_or("webview not found")?;
    webview.hide().map_err(|e: tauri::Error| e.to_string())
}

#[tauri::command]
pub fn close_child_webview(
    app: AppHandle,
    label: String,
) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&label) {
        webview.close().map_err(|e: tauri::Error| e.to_string())?;
    }
    Ok(())
}
