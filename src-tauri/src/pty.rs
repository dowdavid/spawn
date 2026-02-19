use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::Write;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send>,
}

pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

#[tauri::command]
pub fn spawn_pty(
    id: String,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    app: AppHandle,
    state: State<'_, PtyManager>,
) -> Result<(), String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.env("TERM", "xterm-256color");

    if let Some(dir) = cwd {
        cmd.cwd(dir);
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    // Background thread to read PTY output and emit events
    let event_id = id.clone();
    std::thread::spawn(move || {
        let mut buf_reader = std::io::BufReader::new(reader);
        let mut buf = [0u8; 4096];
        let mut last_detected_url: Option<String> = None;
        loop {
            use std::io::Read;
            match buf_reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app.emit(&format!("pty-output-{}", event_id), &data);

                    if let Some(url) = detect_dev_server_url(&data) {
                        let is_new = last_detected_url.as_ref() != Some(&url);
                        if is_new {
                            last_detected_url = Some(url.clone());
                            let _ = app.emit(&format!("dev-server-detected-{}", event_id), &url);
                        }
                    }
                }
                Err(_) => break,
            }
        }
    });

    let session = PtySession {
        writer,
        master: pair.master,
        child,
    };

    state
        .sessions
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id, session);

    Ok(())
}

#[tauri::command]
pub fn write_pty(
    id: String,
    data: String,
    state: State<'_, PtyManager>,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions.get_mut(&id).ok_or("PTY session not found")?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn resize_pty(
    id: String,
    cols: u16,
    rows: u16,
    state: State<'_, PtyManager>,
) -> Result<(), String> {
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions.get(&id).ok_or("PTY session not found")?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn kill_pty(
    id: String,
    state: State<'_, PtyManager>,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(mut session) = sessions.remove(&id) {
        let _ = session.child.kill();
    }
    Ok(())
}

fn detect_dev_server_url(data: &str) -> Option<String> {
    let prefixes = [
        "http://localhost:",
        "https://localhost:",
        "http://127.0.0.1:",
        "https://127.0.0.1:",
        "http://0.0.0.0:",
        "https://0.0.0.0:",
    ];

    for prefix in &prefixes {
        if let Some(start) = data.find(prefix) {
            let rest = &data[start..];
            let url_end = rest
                .find(|c: char| {
                    c.is_whitespace() || c == '"' || c == '\'' || c == '>' || c == ')' || c == ']'
                })
                .unwrap_or(rest.len());
            let mut url = rest[..url_end].to_string();
            if url.contains("0.0.0.0") {
                url = url.replace("0.0.0.0", "localhost");
            }
            return Some(url);
        }
    }
    None
}
