mod pty;
mod project;
mod watcher;
mod workspace;
mod browser_webview;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(pty::PtyManager::new())
        .manage(watcher::WatcherManager::new())
        .invoke_handler(tauri::generate_handler![
            pty::spawn_pty,
            pty::write_pty,
            pty::resize_pty,
            pty::kill_pty,
            project::read_directory,
            project::read_file_contents,
            project::open_file_in_system,
            watcher::watch_directory,
            watcher::unwatch_directory,
            workspace::save_workspace,
            workspace::load_workspace,
            browser_webview::create_child_webview,
            browser_webview::set_child_webview_bounds,
            browser_webview::show_child_webview,
            browser_webview::hide_child_webview,
            browser_webview::close_child_webview,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
