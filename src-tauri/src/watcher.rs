use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

pub struct WatcherManager {
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}

impl WatcherManager {
    pub fn new() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Serialize, Clone)]
pub struct FileChangeEvent {
    pub path: String,
    pub kind: String,
}

#[tauri::command]
pub fn watch_directory(
    id: String,
    path: String,
    app: AppHandle,
    state: State<'_, WatcherManager>,
) -> Result<(), String> {
    let event_id = id.clone();

    let mut watcher = RecommendedWatcher::new(
        move |res: Result<notify::Event, notify::Error>| {
            if let Ok(event) = res {
                let kind = match event.kind {
                    EventKind::Create(_) => "create",
                    EventKind::Modify(_) => "modify",
                    EventKind::Remove(_) => "delete",
                    _ => return,
                };

                for path in event.paths {
                    let _ = app.emit(
                        &format!("file-changed-{}", event_id),
                        FileChangeEvent {
                            path: path.to_string_lossy().to_string(),
                            kind: kind.to_string(),
                        },
                    );
                }
            }
        },
        Config::default(),
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(std::path::Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    state
        .watchers
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id, watcher);

    Ok(())
}

#[tauri::command]
pub fn unwatch_directory(
    id: String,
    state: State<'_, WatcherManager>,
) -> Result<(), String> {
    let mut watchers = state.watchers.lock().map_err(|e| e.to_string())?;
    watchers.remove(&id);
    Ok(())
}
