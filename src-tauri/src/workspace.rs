use tauri::{AppHandle, Manager};
use std::fs;

#[tauri::command]
pub fn save_workspace(state: String, app: AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("workspace.json");
    fs::write(&path, state).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn load_workspace(app: AppHandle) -> Option<String> {
    let dir = app.path().app_data_dir().ok()?;
    let path = dir.join("workspace.json");
    fs::read_to_string(&path).ok()
}
