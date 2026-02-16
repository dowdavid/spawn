# Terminal Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Embed live xterm.js terminals inside canvas nodes, backed by Rust PTY sessions.

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`
- Modify: `src-tauri/Cargo.toml`

**Step 1: Install frontend dependencies**

```bash
cd /Users/daviddow/spawn
npm install @xterm/xterm @xterm/addon-fit @tauri-apps/api
```

**Step 2: Add portable-pty to Cargo.toml**

Add to `[dependencies]` in `src-tauri/Cargo.toml`:
```toml
portable-pty = "0.8"
```

**Step 3: Verify both resolve**

```bash
cd /Users/daviddow/spawn
npx tsc --noEmit
cd src-tauri && source ~/.cargo/env && cargo check
```

**Step 4: Commit**

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "deps: add xterm.js, @tauri-apps/api, and portable-pty"
```

---

### Task 2: Rust PTY backend

**Files:**
- Create: `src-tauri/src/pty.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: Create src-tauri/src/pty.rs**

```rust
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

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

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    // Background thread to read PTY output and emit events
    let event_id = id.clone();
    std::thread::spawn(move || {
        let mut buf_reader = BufReader::new(reader);
        let mut buf = [0u8; 4096];
        loop {
            use std::io::Read;
            match buf_reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app.emit(&format!("pty-output-{}", event_id), data);
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
```

**Step 2: Update src-tauri/src/lib.rs**

Register the PTY manager as state and the commands:

```rust
mod pty;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(pty::PtyManager::new())
        .invoke_handler(tauri::generate_handler![
            pty::spawn_pty,
            pty::write_pty,
            pty::resize_pty,
            pty::kill_pty,
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
```

**Step 3: Add event permission**

Update `src-tauri/capabilities/default.json` to allow event emit:
```json
{
  "permissions": [
    "core:default",
    "core:event:default"
  ]
}
```

**Step 4: Verify Rust compiles**

```bash
cd /Users/daviddow/spawn/src-tauri && source ~/.cargo/env && cargo check
```

**Step 5: Commit**

```bash
git add src-tauri/src/pty.rs src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "feat: add Rust PTY backend with spawn/write/resize/kill commands"
```

---

### Task 3: Frontend terminal manager

**Files:**
- Create: `src/terminal.ts`

**Step 1: Create src/terminal.ts**

```typescript
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Container } from 'pixi.js';

export interface TerminalNode {
  id: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  overlay: HTMLDivElement;
  unlisten: UnlistenFn;
  gfx: any; // PixiJS Graphics reference
}

const BORDER_INSET = 4; // px inset from node edge for terminal
const MIN_VISIBLE_SCALE = 0.3;

const nodes: TerminalNode[] = [];
let overlayContainer: HTMLDivElement;
let activeNodeId: string | null = null;

export function initOverlayContainer(): HTMLDivElement {
  overlayContainer = document.createElement('div');
  overlayContainer.style.cssText =
    'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;z-index:10;';
  document.body.appendChild(overlayContainer);
  return overlayContainer;
}

export async function createTerminalNode(
  id: string,
  gfx: any,
  nodeWidth: number,
  nodeHeight: number,
): Promise<TerminalNode> {
  // Create overlay div
  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:absolute;pointer-events:auto;overflow:hidden;';
  overlayContainer.appendChild(overlay);

  // Create xterm.js instance
  const terminal = new Terminal({
    theme: {
      background: '#16213e',
      foreground: '#e0e0e0',
      cursor: '#e94560',
      selectionBackground: '#0f346080',
    },
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    fontSize: 14,
    allowProposedApi: true,
    cursorBlink: true,
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(overlay);

  // Fit to get initial cols/rows
  fitAddon.fit();
  const cols = terminal.cols;
  const rows = terminal.rows;

  // Spawn PTY backend
  await invoke('spawn_pty', { id, cols, rows });

  // Listen for PTY output
  const unlisten = await listen<string>(`pty-output-${id}`, (event) => {
    terminal.write(event.payload);
  });

  // Send input to PTY
  terminal.onData((data: string) => {
    invoke('write_pty', { id, data });
  });

  // Focus handling
  overlay.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    setActiveNode(id);
  });

  const node: TerminalNode = { id, terminal, fitAddon, overlay, unlisten, gfx };
  nodes.push(node);
  return node;
}

export function setActiveNode(id: string | null) {
  activeNodeId = id;
  for (const node of nodes) {
    if (node.id === id) {
      node.terminal.focus();
      // Bright border for focused node
      node.gfx.clear()
        .roundRect(0, 0, node.gfx.width, node.gfx.height, 8)
        .fill('#16213e')
        .stroke({ width: 2, color: '#e94560' });
    } else {
      node.terminal.blur();
      node.gfx.clear()
        .roundRect(0, 0, node.gfx.width, node.gfx.height, 8)
        .fill('#16213e')
        .stroke({ width: 2, color: '#0f3460' });
    }
  }
}

export function blurAllTerminals() {
  setActiveNode(null);
}

export function syncOverlays(world: Container) {
  const scale = world.scale.x;
  const worldX = world.x;
  const worldY = world.y;

  for (const node of nodes) {
    if (scale < MIN_VISIBLE_SCALE) {
      node.overlay.style.display = 'none';
      continue;
    }

    node.overlay.style.display = 'block';

    const x = node.gfx.x * scale + worldX + BORDER_INSET * scale;
    const y = node.gfx.y * scale + worldY + BORDER_INSET * scale;
    const w = (node.gfx.width - BORDER_INSET * 2) * scale;
    const h = (node.gfx.height - BORDER_INSET * 2) * scale;

    node.overlay.style.left = `${x}px`;
    node.overlay.style.top = `${y}px`;
    node.overlay.style.width = `${w}px`;
    node.overlay.style.height = `${h}px`;

    // Scale the terminal content to match zoom
    node.overlay.style.transformOrigin = 'top left';
    node.overlay.style.transform = `scale(${scale})`;
    node.overlay.style.width = `${node.gfx.width - BORDER_INSET * 2}px`;
    node.overlay.style.height = `${node.gfx.height - BORDER_INSET * 2}px`;
  }
}

export async function destroyTerminalNode(id: string) {
  const idx = nodes.findIndex((n) => n.id === id);
  if (idx === -1) return;
  const node = nodes[idx];
  node.unlisten();
  node.terminal.dispose();
  node.overlay.remove();
  await invoke('kill_pty', { id });
  nodes.splice(idx, 1);
  if (activeNodeId === id) activeNodeId = null;
}
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/terminal.ts
git commit -m "feat: add terminal manager with xterm.js overlays and PTY wiring"
```

---

### Task 4: Integrate terminal into node creation and canvas

**Files:**
- Modify: `src/node.ts`
- Modify: `src/main.ts`
- Modify: `src/canvas.ts`

**Step 1: Update src/node.ts**

Export the Graphics reference and node dimensions so terminal.ts can use them. Change `createNode` to return the Graphics object as part of the result:

```typescript
import { Container, Graphics, FederatedPointerEvent } from 'pixi.js';

export const NODE_WIDTH = 400;
export const NODE_HEIGHT = 300;
const CORNER_RADIUS = 8;
const FILL_COLOR = '#16213e';
const BORDER_COLOR = '#0f3460';

export interface NodeHandle {
  id: string;
  gfx: Graphics;
}

export function createNode(world: Container, x: number, y: number): NodeHandle {
  const id = crypto.randomUUID();

  const gfx = new Graphics()
    .roundRect(0, 0, NODE_WIDTH, NODE_HEIGHT, CORNER_RADIUS)
    .fill(FILL_COLOR)
    .stroke({ width: 2, color: BORDER_COLOR });

  gfx.x = x;
  gfx.y = y;
  gfx.eventMode = 'static';
  gfx.cursor = 'pointer';

  let dragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  gfx.on('pointerdown', (event: FederatedPointerEvent) => {
    if (event.button !== 0) return;

    dragging = true;
    const local = event.getLocalPosition(world);
    dragOffsetX = local.x - gfx.x;
    dragOffsetY = local.y - gfx.y;

    world.setChildIndex(gfx, world.children.length - 1);
    event.stopPropagation();
  });

  gfx.on('globalpointermove', (event: FederatedPointerEvent) => {
    if (!dragging) return;
    const local = event.getLocalPosition(world);
    gfx.x = local.x - dragOffsetX;
    gfx.y = local.y - dragOffsetY;
  });

  gfx.on('pointerup', () => {
    dragging = false;
  });

  gfx.on('pointerupoutside', () => {
    dragging = false;
  });

  world.addChild(gfx);

  return { id, gfx };
}
```

**Step 2: Update src/main.ts**

Wire up terminal creation, overlay sync loop, and focus management:

```typescript
import { Application, FederatedPointerEvent } from 'pixi.js';
import { createCanvas } from './canvas';
import { createNode, NODE_WIDTH, NODE_HEIGHT } from './node';
import {
  initOverlayContainer,
  createTerminalNode,
  syncOverlays,
  blurAllTerminals,
} from './terminal';
import '@xterm/xterm/css/xterm.css';

async function init() {
  const app = new Application();

  await app.init({
    background: '#1a1a2e',
    resizeTo: window,
    antialias: true,
    preference: 'webgl',
  });

  document.body.appendChild(app.canvas);
  initOverlayContainer();

  const world = createCanvas(app);

  // Spawn initial node
  const initial = createNode(world, 100, 100);
  await createTerminalNode(initial.id, initial.gfx, NODE_WIDTH, NODE_HEIGHT);

  // Double-click to spawn new nodes
  let lastClickTime = 0;
  app.stage.on('click', async (event: FederatedPointerEvent) => {
    const now = performance.now();
    if (now - lastClickTime < 300) {
      const worldX = (event.global.x - world.x) / world.scale.x;
      const worldY = (event.global.y - world.y) / world.scale.y;
      const handle = createNode(world, worldX, worldY);
      await createTerminalNode(handle.id, handle.gfx, NODE_WIDTH, NODE_HEIGHT);
      lastClickTime = 0;
    } else {
      lastClickTime = now;
    }
  });

  // Click canvas background to blur all terminals
  app.stage.on('pointerdown', (event: FederatedPointerEvent) => {
    // Only if clicking empty space (not a node)
    if (event.target === app.stage) {
      blurAllTerminals();
    }
  });

  // Overlay sync loop
  function syncLoop() {
    syncOverlays(world);
    requestAnimationFrame(syncLoop);
  }
  requestAnimationFrame(syncLoop);
}

init();
```

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Note: The `@xterm/xterm/css/xterm.css` import requires Vite's CSS handling — Vite handles this natively, no config needed.

**Step 4: Verify full app launches**

```bash
npm run tauri:dev
```

Expected: A Tauri window opens with a terminal node at (100, 100). The terminal shows a shell prompt. Typing sends input. Double-click spawns new terminal nodes. Pan/zoom still work, overlays track node positions.

**Step 5: Commit**

```bash
git add src/node.ts src/main.ts src/canvas.ts
git commit -m "feat: integrate xterm.js terminals into canvas nodes"
```

---

## Summary

| Task | What it does |
|------|-------------|
| 1 | Install xterm.js, @tauri-apps/api, portable-pty |
| 2 | Rust PTY backend — spawn/write/resize/kill commands |
| 3 | Frontend terminal manager — xterm.js overlays, focus, sync |
| 4 | Wire everything together — node creation spawns terminals |
