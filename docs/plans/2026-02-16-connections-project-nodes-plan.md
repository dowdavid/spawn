# Connections & Project Nodes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add project nodes (file trees linked to directories), SVG connection edges between terminals and projects, keyboard shortcuts for node creation, and a read-only code viewer.

**Architecture:** Centralized state (`state.ts`) tracks all nodes and connections. Project nodes use the same HTML overlay pattern as terminals. Connections render as SVG bezier curves in a dedicated SVG layer between the PixiJS canvas and HTML overlays. Rust backend adds directory reading (`project.rs`), file watching (`watcher.rs`), and an optional `cwd` param on `spawn_pty`.

**Tech Stack:** Tauri 2.0, PixiJS v8, xterm.js, `notify 7` (Rust), `tauri-plugin-dialog` (directory picker), vanilla TypeScript

---

### Task 1: Centralized state module

**Files:**
- Create: `src/state.ts`
- Modify: `src/terminal.ts`
- Modify: `src/main.ts`

**Step 1: Create `src/state.ts`**

This module holds all node and connection tracking. Terminal and project modules register their nodes here. The overlay container and active-node management move here too.

```typescript
// src/state.ts
import type { Graphics, Container } from 'pixi.js';

export type NodeType = 'terminal' | 'project';

export interface NodeEntry {
  id: string;
  type: NodeType;
  gfx: Graphics;
  overlay: HTMLDivElement;
  width: number;
  height: number;
  connectedTo?: string;
}

export interface Connection {
  id: string;
  sourceId: string;
  targetId: string;
  element: SVGPathElement | null;
}

const nodes = new Map<string, NodeEntry>();
const connections = new Map<string, Connection>();
let activeNodeId: string | null = null;
let overlayContainer: HTMLDivElement;

export function initOverlayContainer(): HTMLDivElement {
  overlayContainer = document.createElement('div');
  overlayContainer.style.cssText =
    'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;z-index:10;';
  document.body.appendChild(overlayContainer);
  return overlayContainer;
}

export function getOverlayContainer(): HTMLDivElement {
  return overlayContainer;
}

export function registerNode(entry: NodeEntry) {
  nodes.set(entry.id, entry);
}

export function unregisterNode(id: string) {
  nodes.delete(id);
  // Remove any connections involving this node
  for (const [connId, conn] of connections) {
    if (conn.sourceId === id || conn.targetId === id) {
      if (conn.element) conn.element.remove();
      connections.delete(connId);
    }
  }
  if (activeNodeId === id) activeNodeId = null;
}

export function getNode(id: string): NodeEntry | undefined {
  return nodes.get(id);
}

export function getAllNodes(): NodeEntry[] {
  return Array.from(nodes.values());
}

export function getNodesByType(type: NodeType): NodeEntry[] {
  return getAllNodes().filter((n) => n.type === type);
}

export function addConnection(sourceId: string, targetId: string): Connection {
  const id = crypto.randomUUID();
  const conn: Connection = { id, sourceId, targetId, element: null };
  connections.set(id, conn);
  // Mark the terminal as connected
  const source = nodes.get(sourceId);
  if (source) source.connectedTo = targetId;
  return conn;
}

export function removeConnection(id: string) {
  const conn = connections.get(id);
  if (!conn) return;
  if (conn.element) conn.element.remove();
  // Clear the terminal's connectedTo
  const source = nodes.get(conn.sourceId);
  if (source) source.connectedTo = undefined;
  connections.delete(id);
}

export function getAllConnections(): Connection[] {
  return Array.from(connections.values());
}

export function getConnectionsForNode(nodeId: string): Connection[] {
  return getAllConnections().filter(
    (c) => c.sourceId === nodeId || c.targetId === nodeId,
  );
}

export function setActiveNodeId(id: string | null) {
  activeNodeId = id;
}

export function getActiveNodeId(): string | null {
  return activeNodeId;
}
```

**Step 2: Update `src/terminal.ts` to use state**

Remove the local `nodes` array, `activeNodeId`, `overlayContainer`, and `initOverlayContainer` from `terminal.ts`. Import from `state.ts` instead. The `setActiveNode` function stays in `terminal.ts` for now (it handles terminal-specific focus/blur logic) but reads/writes through state.

Replace the module-level variables and imports at the top of `terminal.ts`:

```typescript
// src/terminal.ts
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Container, Graphics } from 'pixi.js';
import { NODE_WIDTH, NODE_HEIGHT, TITLE_BAR_HEIGHT } from './node';
import {
  registerNode,
  unregisterNode,
  getNode,
  getAllNodes,
  getNodesByType,
  setActiveNodeId,
  getActiveNodeId,
  getOverlayContainer,
} from './state';

export interface TerminalNodeData {
  id: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  unlisten: UnlistenFn;
}

const BORDER_WIDTH = 2;
const CORNER_RADIUS = 8;

const BORDER_DEFAULT = '#0f3460';
const BORDER_FOCUSED = '#e94560';
const FILL_COLOR = '#16213e';
const TITLE_BAR_COLOR = '#0f2040';

// Terminal-specific data not stored in state
const terminalData = new Map<string, TerminalNodeData>();
```

Update `createTerminalNode` — change `overlayContainer.appendChild(overlay)` to `getOverlayContainer().appendChild(overlay)`. At the end of the function, replace `nodes.push(node)` with:

```typescript
  registerNode({
    id,
    type: 'terminal',
    gfx,
    overlay,
    width: nodeWidth,
    height: nodeHeight,
  });
  terminalData.set(id, { id, terminal, fitAddon, unlisten });
```

Update `setActiveNode`:

```typescript
export function setActiveNode(id: string | null) {
  setActiveNodeId(id);
  for (const data of terminalData.values()) {
    const entry = getNode(data.id);
    if (!entry) continue;
    if (data.id === id) {
      data.terminal.focus();
      entry.overlay.style.borderColor = BORDER_FOCUSED;
      entry.overlay.style.zIndex = `${getAllNodes().length + 1}`;
    } else {
      data.terminal.blur();
      entry.overlay.style.borderColor = BORDER_DEFAULT;
    }
  }
}
```

Update `blurAllTerminals` — keep as-is (it calls `setActiveNode(null)`).

Update `syncOverlays` to read from state:

```typescript
export function syncOverlays(world: Container) {
  const scale = world.scale.x;
  const worldX = world.x;
  const worldY = world.y;

  for (const node of getAllNodes()) {
    node.overlay.style.display = 'block';

    const x = node.gfx.x * scale + worldX;
    const y = node.gfx.y * scale + worldY;

    const childIndex = world.children.indexOf(node.gfx);
    if (node.id !== getActiveNodeId()) {
      node.overlay.style.zIndex = `${childIndex}`;
    }

    node.overlay.style.left = `${x}px`;
    node.overlay.style.top = `${y}px`;
    node.overlay.style.width = `${node.width}px`;
    node.overlay.style.height = `${node.height}px`;
    node.overlay.style.transformOrigin = 'top left';
    node.overlay.style.transform = `scale(${scale})`;
  }
}
```

Update `destroyTerminalNode`:

```typescript
export async function destroyTerminalNode(id: string) {
  const data = terminalData.get(id);
  if (!data) return;
  data.unlisten();
  data.terminal.dispose();
  const entry = getNode(id);
  if (entry) entry.overlay.remove();
  await invoke('kill_pty', { id });
  terminalData.delete(id);
  unregisterNode(id);
}
```

**Step 3: Update `src/main.ts`**

Change the `initOverlayContainer` import to come from `state.ts`:

```typescript
import { initOverlayContainer } from './state';
import {
  createTerminalNode,
  syncOverlays,
  blurAllTerminals,
} from './terminal';
```

Everything else in `main.ts` stays the same.

**Step 4: Verify app runs**

```bash
npm run tauri:dev
```

Expected: App launches, terminal node works exactly as before — create, drag, type, close. No behavior changes.

**Step 5: Commit**

```bash
git add src/state.ts src/terminal.ts src/main.ts
git commit -m "refactor: centralize node/connection state into state.ts"
```

---

### Task 2: Add optional `cwd` to `spawn_pty`

**Files:**
- Modify: `src-tauri/src/pty.rs`
- Modify: `src/terminal.ts`

**Step 1: Update Rust `spawn_pty` to accept optional `cwd`**

In `src-tauri/src/pty.rs`, add a `cwd` parameter to `spawn_pty`:

```rust
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
```

The rest of the function stays identical.

**Step 2: Update frontend `invoke` call**

In `src/terminal.ts`, update the `createTerminalNode` function signature to accept an optional `cwd` parameter, and pass it to the Rust command:

Change the function signature:

```typescript
export async function createTerminalNode(
  id: string,
  gfx: Graphics,
  nodeWidth: number,
  nodeHeight: number,
  cwd?: string,
): Promise<void> {
```

Change the `invoke` call from:
```typescript
  await invoke('spawn_pty', { id, cols, rows });
```
to:
```typescript
  await invoke('spawn_pty', { id, cols, rows, cwd: cwd ?? null });
```

**Step 3: Verify app runs**

```bash
npm run tauri:dev
```

Expected: App launches, existing terminals work (no cwd passed = home directory). No behavior change yet — cwd will be used when connected terminals are added.

**Step 4: Commit**

```bash
git add src-tauri/src/pty.rs src/terminal.ts
git commit -m "feat: add optional cwd parameter to spawn_pty"
```

---

### Task 3: Rust project commands and dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/project.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `package.json` (install dialog plugin)

**Step 1: Add dependencies**

Add to `src-tauri/Cargo.toml` under `[dependencies]`:

```toml
notify = "7"
tauri-plugin-dialog = "2"
```

Install frontend dialog plugin:

```bash
cd /Users/daviddow/spawn
npm install @tauri-apps/plugin-dialog
```

**Step 2: Create `src-tauri/src/project.rs`**

```rust
// src-tauri/src/project.rs
use serde::Serialize;
use std::fs;

#[derive(Serialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
}

#[tauri::command]
pub fn read_directory(path: String) -> Result<Vec<FileEntry>, String> {
    let mut entries = Vec::new();

    let dir = fs::read_dir(&path).map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files
        if name.starts_with('.') {
            continue;
        }

        entries.push(FileEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_directory: metadata.is_dir(),
        });
    }

    // Sort: directories first, then alphabetical
    entries.sort_by(|a, b| {
        b.is_directory
            .cmp(&a.is_directory)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

#[tauri::command]
pub fn read_file_contents(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
pub fn open_file_in_system(path: String) -> Result<(), String> {
    open::that(&path).map_err(|e| format!("Failed to open file: {}", e))
}
```

Note: `open_file_in_system` uses the `open` crate. Add it to `Cargo.toml`:

```toml
open = "5"
```

**Step 3: Update `src-tauri/src/lib.rs`**

```rust
mod pty;
mod project;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(pty::PtyManager::new())
        .invoke_handler(tauri::generate_handler![
            pty::spawn_pty,
            pty::write_pty,
            pty::resize_pty,
            pty::kill_pty,
            project::read_directory,
            project::read_file_contents,
            project::open_file_in_system,
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

**Step 4: Update capabilities**

Update `src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "enables the default permissions",
  "windows": [
    "main"
  ],
  "permissions": [
    "core:default",
    "core:event:default",
    "dialog:default"
  ]
}
```

**Step 5: Verify Rust compiles**

```bash
cd /Users/daviddow/spawn/src-tauri && cargo check
```

Expected: Compiles without errors.

**Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/project.rs src-tauri/src/lib.rs src-tauri/capabilities/default.json package.json package-lock.json
git commit -m "feat: add Rust project commands (read_directory, read_file, open_file) and dialog plugin"
```

---

### Task 4: Project node frontend rendering

**Files:**
- Create: `src/project.ts`
- Modify: `src/node.ts`
- Modify: `src/main.ts`
- Modify: `src/style.css`

**Step 1: Add project node constants to `src/node.ts`**

Add these constants alongside the existing terminal ones:

```typescript
export const PROJECT_WIDTH = 400;
export const PROJECT_HEIGHT = 600;
```

**Step 2: Create `src/project.ts`**

```typescript
// src/project.ts
import { invoke } from '@tauri-apps/api/core';
import type { Graphics } from 'pixi.js';
import { TITLE_BAR_HEIGHT } from './node';
import {
  registerNode,
  unregisterNode,
  getNode,
  setActiveNodeId,
  getActiveNodeId,
  getOverlayContainer,
  getAllNodes,
} from './state';

interface FileEntry {
  name: string;
  path: string;
  is_directory: boolean;
}

const BORDER_WIDTH = 2;
const CORNER_RADIUS = 8;
const BORDER_DEFAULT = '#0f3460';
const BORDER_FOCUSED = '#e94560';
const FILL_COLOR = '#16213e';
const TITLE_BAR_COLOR = '#0f2040';

// Track expanded folders per project
const expandedFolders = new Map<string, Set<string>>();

export async function createProjectNode(
  id: string,
  gfx: Graphics,
  nodeWidth: number,
  nodeHeight: number,
  dirPath: string,
): Promise<void> {
  const overlay = document.createElement('div');
  overlay.className = 'project-overlay';
  overlay.style.cssText = `
    position:absolute;
    pointer-events:auto;
    overflow:hidden;
    background:${FILL_COLOR};
    border:${BORDER_WIDTH}px solid ${BORDER_DEFAULT};
    border-radius:${CORNER_RADIUS}px;
    box-sizing:border-box;
  `;
  overlay.style.width = `${nodeWidth}px`;
  overlay.style.height = `${nodeHeight}px`;
  getOverlayContainer().appendChild(overlay);

  // Title bar
  const folderName = dirPath.split('/').pop() || dirPath;
  const titleBar = document.createElement('div');
  titleBar.style.cssText = `
    width:100%;
    height:${TITLE_BAR_HEIGHT}px;
    background:${TITLE_BAR_COLOR};
    cursor:grab;
    border-radius:${CORNER_RADIUS - BORDER_WIDTH}px ${CORNER_RADIUS - BORDER_WIDTH}px 0 0;
    display:flex;
    align-items:center;
    padding:0 8px;
    gap:6px;
  `;

  // Drag grip icon
  const gripIcon = document.createElement('div');
  gripIcon.style.cssText = 'display:flex;align-items:center;';
  gripIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4a5568" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>`;
  titleBar.appendChild(gripIcon);

  // Folder icon + name
  const titleLabel = document.createElement('div');
  titleLabel.style.cssText = 'flex:1;color:#8899aa;font-family:Menlo,Monaco,monospace;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  titleLabel.textContent = folderName;
  titleBar.appendChild(titleLabel);

  // Close button
  const closeBtn = document.createElement('div');
  closeBtn.style.cssText = 'display:flex;align-items:center;cursor:pointer;padding:2px;border-radius:4px;';
  closeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4a5568" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
  closeBtn.addEventListener('mouseenter', () => { closeBtn.querySelector('svg')!.style.stroke = '#e94560'; });
  closeBtn.addEventListener('mouseleave', () => { closeBtn.querySelector('svg')!.style.stroke = '#4a5568'; });
  closeBtn.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    destroyProjectNode(id);
    const parent = gfx.parent;
    if (parent) parent.removeChild(gfx);
  });
  titleBar.appendChild(closeBtn);
  overlay.appendChild(titleBar);

  // File tree container
  const treeContainer = document.createElement('div');
  treeContainer.style.cssText = `
    width:100%;
    height:calc(100% - ${TITLE_BAR_HEIGHT}px);
    overflow-y:auto;
    overflow-x:hidden;
    padding:8px 0;
    box-sizing:border-box;
  `;
  overlay.appendChild(treeContainer);

  // Title bar drag
  let dragging = false;
  let dragStartWorldX = 0;
  let dragStartWorldY = 0;
  let gfxStartX = 0;
  let gfxStartY = 0;

  titleBar.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const parent = gfx.parent;
    if (parent) parent.setChildIndex(gfx, parent.children.length - 1);
    setActiveProjectNode(id);
    dragging = true;
    titleBar.style.cursor = 'grabbing';
    dragStartWorldX = e.clientX;
    dragStartWorldY = e.clientY;
    gfxStartX = gfx.x;
    gfxStartY = gfx.y;
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const scale = gfx.parent?.scale.x ?? 1;
    gfx.x = gfxStartX + (e.clientX - dragStartWorldX) / scale;
    gfx.y = gfxStartY + (e.clientY - dragStartWorldY) / scale;
  });

  window.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      titleBar.style.cursor = 'grab';
    }
  });

  // Click tree area to focus
  treeContainer.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    const parent = gfx.parent;
    if (parent) parent.setChildIndex(gfx, parent.children.length - 1);
    setActiveProjectNode(id);
  });

  // Register in state
  registerNode({
    id,
    type: 'project',
    gfx,
    overlay,
    width: nodeWidth,
    height: nodeHeight,
  });

  // Store expanded folders set
  expandedFolders.set(id, new Set());

  // Store dirPath and treeContainer for later use
  projectData.set(id, { dirPath, treeContainer });

  // Load initial file tree
  await renderTree(id, dirPath, treeContainer, 0);
}

interface ProjectData {
  dirPath: string;
  treeContainer: HTMLDivElement;
}

const projectData = new Map<string, ProjectData>();

export function getProjectPath(id: string): string | undefined {
  return projectData.get(id)?.dirPath;
}

async function renderTree(
  projectId: string,
  dirPath: string,
  container: HTMLDivElement,
  depth: number,
) {
  let entries: FileEntry[];
  try {
    entries = await invoke<FileEntry[]>('read_directory', { path: dirPath });
  } catch {
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = 'color:#e94560;padding:4px 12px;font-size:12px;font-family:Menlo,monospace;';
    errorDiv.textContent = 'Failed to read directory';
    container.appendChild(errorDiv);
    return;
  }

  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'file-tree-row';
    row.style.cssText = `
      padding:3px 12px 3px ${12 + depth * 16}px;
      font-family:Menlo,Monaco,monospace;
      font-size:12px;
      color:#c0c8d0;
      cursor:pointer;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
      display:flex;
      align-items:center;
      gap:4px;
    `;

    if (entry.is_directory) {
      const expanded = expandedFolders.get(projectId);
      const isExpanded = expanded?.has(entry.path) ?? false;
      const arrow = document.createElement('span');
      arrow.style.cssText = 'font-size:10px;width:12px;flex-shrink:0;color:#6a7a8a;';
      arrow.textContent = isExpanded ? '\u25BC' : '\u25B6';
      row.appendChild(arrow);

      const name = document.createElement('span');
      name.textContent = entry.name;
      row.appendChild(name);

      // Children container
      const childContainer = document.createElement('div');
      childContainer.style.display = isExpanded ? 'block' : 'none';

      if (isExpanded) {
        await renderTree(projectId, entry.path, childContainer, depth + 1);
      }

      row.addEventListener('click', async (e) => {
        e.stopPropagation();
        const exp = expandedFolders.get(projectId)!;
        if (exp.has(entry.path)) {
          exp.delete(entry.path);
          arrow.textContent = '\u25B6';
          childContainer.style.display = 'none';
          childContainer.innerHTML = '';
        } else {
          exp.add(entry.path);
          arrow.textContent = '\u25BC';
          childContainer.innerHTML = '';
          await renderTree(projectId, entry.path, childContainer, depth + 1);
          childContainer.style.display = 'block';
        }
      });

      container.appendChild(row);
      container.appendChild(childContainer);
    } else {
      const spacer = document.createElement('span');
      spacer.style.cssText = 'width:12px;flex-shrink:0;';
      row.appendChild(spacer);

      const name = document.createElement('span');
      name.textContent = entry.name;
      row.appendChild(name);

      // Double-click to open code viewer (wired in Task 7)
      row.dataset.filePath = entry.path;
      row.dataset.fileName = entry.name;

      row.addEventListener('click', (e) => {
        e.stopPropagation();
      });

      container.appendChild(row);
    }

    // Hover effect
    row.addEventListener('mouseenter', () => { row.style.background = '#1a2a40'; });
    row.addEventListener('mouseleave', () => { row.style.background = 'none'; });
  }
}

export function setActiveProjectNode(id: string) {
  setActiveNodeId(id);
  // Update border colors on all project overlays
  for (const [pid, _data] of projectData) {
    const entry = getNode(pid);
    if (!entry) continue;
    if (pid === id) {
      entry.overlay.style.borderColor = BORDER_FOCUSED;
      entry.overlay.style.zIndex = `${getAllNodes().length + 1}`;
    } else {
      entry.overlay.style.borderColor = BORDER_DEFAULT;
    }
  }
}

export async function refreshProjectTree(projectId: string) {
  const data = projectData.get(projectId);
  if (!data) return;
  data.treeContainer.innerHTML = '';
  await renderTree(projectId, data.dirPath, data.treeContainer, 0);
}

export function destroyProjectNode(id: string) {
  const entry = getNode(id);
  if (entry) entry.overlay.remove();
  projectData.delete(id);
  expandedFolders.delete(id);
  unregisterNode(id);
}
```

**Step 3: Add project node CSS to `src/style.css`**

Append to the existing file:

```css
/* Project node overlays */
.project-overlay {
  isolation: isolate;
  background: #16213e;
}

.project-overlay::-webkit-scrollbar {
  width: 6px;
}

.project-overlay::-webkit-scrollbar-track {
  background: transparent;
}

.project-overlay::-webkit-scrollbar-thumb {
  background: #2a3a4a;
  border-radius: 3px;
}
```

**Step 4: Update `src/main.ts` with `Cmd+P` shortcut**

Add imports at top of `main.ts`:

```typescript
import { open } from '@tauri-apps/plugin-dialog';
import { createProjectNode } from './project';
import { createNode, NODE_WIDTH, NODE_HEIGHT, PROJECT_WIDTH, PROJECT_HEIGHT } from './node';
```

Add keyboard shortcut listener inside `init()`, after the sync loop setup:

```typescript
  // Keyboard shortcuts
  window.addEventListener('keydown', async (e) => {
    // Don't capture shortcuts when terminal is focused
    const active = getActiveNodeId();
    const activeEntry = active ? getNode(active) : null;
    if (activeEntry?.type === 'terminal') return;

    // Cmd+P — new project node
    if (e.metaKey && !e.shiftKey && e.code === 'KeyP') {
      e.preventDefault();
      const selected = await open({ directory: true });
      if (typeof selected === 'string') {
        // Center in viewport
        const viewX = (-world.x + window.innerWidth / 2) / world.scale.x - PROJECT_WIDTH / 2;
        const viewY = (-world.y + window.innerHeight / 2) / world.scale.y - PROJECT_HEIGHT / 2;
        const handle = createNode(world, viewX, viewY);
        await createProjectNode(handle.id, handle.gfx, PROJECT_WIDTH, PROJECT_HEIGHT, selected);
      }
    }
  });
```

Add the `getActiveNodeId` and `getNode` imports from state:

```typescript
import { initOverlayContainer, getActiveNodeId, getNode } from './state';
```

**Step 5: Verify project node works**

```bash
npm run tauri:dev
```

Expected: Press `Cmd+P`, directory picker opens. Select a folder. A 400x600 project node appears at viewport center with a file tree. Click folders to expand/collapse. Drag title bar to reposition. Close button removes the node.

**Step 6: Commit**

```bash
git add src/project.ts src/node.ts src/main.ts src/style.css package.json package-lock.json
git commit -m "feat: add project node with file tree rendering and Cmd+P shortcut"
```

---

### Task 5: File watcher

**Files:**
- Create: `src-tauri/src/watcher.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/project.ts`

**Step 1: Create `src-tauri/src/watcher.rs`**

```rust
// src-tauri/src/watcher.rs
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
```

**Step 2: Register watcher in `src-tauri/src/lib.rs`**

Add `mod watcher;` at the top.

Add `.manage(watcher::WatcherManager::new())` to the builder.

Add `watcher::watch_directory` and `watcher::unwatch_directory` to the `invoke_handler`:

```rust
mod pty;
mod project;
mod watcher;

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

**Step 3: Wire watcher in `src/project.ts`**

Add file watcher setup at the end of `createProjectNode`, after the initial tree render:

```typescript
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
```

Add `unlisten` to `ProjectData`:

```typescript
interface ProjectData {
  dirPath: string;
  treeContainer: HTMLDivElement;
  unlisten: UnlistenFn | null;
}
```

At the end of `createProjectNode`, after the `renderTree` call:

```typescript
  // Start file watcher
  await invoke('watch_directory', { id, path: dirPath });

  // Debounced refresh on file changes
  let refreshTimeout: ReturnType<typeof setTimeout> | null = null;
  const unlisten = await listen<{ path: string; kind: string }>(
    `file-changed-${id}`,
    () => {
      if (refreshTimeout) clearTimeout(refreshTimeout);
      refreshTimeout = setTimeout(() => refreshProjectTree(id), 300);
    },
  );

  projectData.set(id, { dirPath, treeContainer, unlisten });
```

Update `destroyProjectNode` to clean up:

```typescript
export async function destroyProjectNode(id: string) {
  const data = projectData.get(id);
  if (data?.unlisten) data.unlisten();
  await invoke('unwatch_directory', { id }).catch(() => {});
  const entry = getNode(id);
  if (entry) entry.overlay.remove();
  projectData.delete(id);
  expandedFolders.delete(id);
  unregisterNode(id);
}
```

**Step 4: Verify watcher works**

```bash
npm run tauri:dev
```

Expected: Create a project node pointing to a test directory. Open a separate terminal, create a file in that directory with `touch test.txt`. The file appears in the project node's tree within ~300ms.

**Step 5: Commit**

```bash
git add src-tauri/src/watcher.rs src-tauri/src/lib.rs src/project.ts
git commit -m "feat: add file watcher with debounced tree refresh"
```

---

### Task 6: SVG connection layer

**Files:**
- Create: `src/connection.ts`
- Modify: `src/main.ts`

**Step 1: Create `src/connection.ts`**

```typescript
// src/connection.ts
import type { Container } from 'pixi.js';
import { getAllConnections, getNode } from './state';

let svgLayer: SVGSVGElement;

export function initConnectionLayer(): SVGSVGElement {
  svgLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgLayer.style.cssText =
    'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;';
  document.body.appendChild(svgLayer);
  return svgLayer;
}

export function createConnectionPath(): SVGPathElement {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#4a9eff');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-opacity', '0.6');
  svgLayer.appendChild(path);
  return path;
}

export function syncConnections(world: Container) {
  const scale = world.scale.x;
  const worldX = world.x;
  const worldY = world.y;

  for (const conn of getAllConnections()) {
    const source = getNode(conn.sourceId);
    const target = getNode(conn.targetId);

    if (!source || !target) {
      if (conn.element) conn.element.setAttribute('d', '');
      continue;
    }

    // Ensure SVG path element exists
    if (!conn.element) {
      conn.element = createConnectionPath();
    }

    // Screen positions of node centers
    const sx = source.gfx.x * scale + worldX + (source.width * scale) / 2;
    const sy = source.gfx.y * scale + worldY + (source.height * scale) / 2;
    const tx = target.gfx.x * scale + worldX + (target.width * scale) / 2;
    const ty = target.gfx.y * scale + worldY + (target.height * scale) / 2;

    // Find edge anchor points (exit from nearest edge of source, enter nearest edge of target)
    const [x1, y1] = getEdgePoint(
      source.gfx.x * scale + worldX,
      source.gfx.y * scale + worldY,
      source.width * scale,
      source.height * scale,
      tx, ty,
    );
    const [x2, y2] = getEdgePoint(
      target.gfx.x * scale + worldX,
      target.gfx.y * scale + worldY,
      target.width * scale,
      target.height * scale,
      sx, sy,
    );

    // Bezier control points — offset toward the other node
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const curvature = Math.min(dist * 0.3, 80 * scale);

    // Control points push perpendicular or along the axis
    const cx1 = x1 + (dx > 0 ? curvature : -curvature);
    const cy1 = y1;
    const cx2 = x2 - (dx > 0 ? curvature : -curvature);
    const cy2 = y2;

    conn.element.setAttribute(
      'd',
      `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`,
    );
  }
}

function getEdgePoint(
  nodeX: number,
  nodeY: number,
  nodeW: number,
  nodeH: number,
  targetX: number,
  targetY: number,
): [number, number] {
  const cx = nodeX + nodeW / 2;
  const cy = nodeY + nodeH / 2;
  const dx = targetX - cx;
  const dy = targetY - cy;

  if (dx === 0 && dy === 0) return [cx, cy];

  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const halfW = nodeW / 2;
  const halfH = nodeH / 2;

  // Check which edge the line from center to target intersects
  if (absDx * halfH > absDy * halfW) {
    // Hits left or right edge
    const sign = dx > 0 ? 1 : -1;
    return [cx + sign * halfW, cy + (dy * halfW) / absDx];
  } else {
    // Hits top or bottom edge
    const sign = dy > 0 ? 1 : -1;
    return [cx + (dx * halfH) / absDy, cy + sign * halfH];
  }
}
```

**Step 2: Update `src/main.ts` to init SVG layer and sync**

Add import:

```typescript
import { initConnectionLayer, syncConnections } from './connection';
```

After `initOverlayContainer()`, add:

```typescript
  initConnectionLayer();
```

Update the sync loop to also sync connections:

```typescript
  function syncLoop() {
    syncOverlays(world);
    syncConnections(world);
    requestAnimationFrame(syncLoop);
  }
```

**Step 3: Verify SVG layer exists**

```bash
npm run tauri:dev
```

Expected: App runs. No visible connections yet (none created). Inspect DOM — an `<svg>` element should exist between the canvas and the overlay container.

**Step 4: Commit**

```bash
git add src/connection.ts src/main.ts
git commit -m "feat: add SVG connection layer with bezier edge rendering"
```

---

### Task 7: Connected terminal creation with keyboard shortcuts

**Files:**
- Modify: `src/main.ts`
- Modify: `src/terminal.ts`

**Step 1: Update `src/terminal.ts` — connected terminal visuals**

Add a subtitle to the title bar when connected. Update `createTerminalNode` to accept optional `connectedProjectPath`:

Change the signature:

```typescript
export async function createTerminalNode(
  id: string,
  gfx: Graphics,
  nodeWidth: number,
  nodeHeight: number,
  cwd?: string,
  connectedProjectPath?: string,
): Promise<void> {
```

After creating the title bar `gripIcon`, add a subtitle if connected:

```typescript
  // Title label (shows project path if connected)
  if (connectedProjectPath) {
    const titleLabel = document.createElement('div');
    const shortPath = connectedProjectPath.replace(/^\/Users\/[^/]+/, '~');
    titleLabel.style.cssText = 'color:#6a7a8a;font-family:Menlo,Monaco,monospace;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    titleLabel.textContent = shortPath;
    titleBar.insertBefore(titleLabel, spacer);
  }
```

**Step 2: Update `src/main.ts` — full keyboard shortcut handler**

Replace the keyboard shortcut listener with the complete version handling all three shortcuts:

```typescript
import { addConnection, initOverlayContainer, getActiveNodeId, getNode, getNodesByType } from './state';
import { getProjectPath } from './project';

  // Keyboard shortcuts
  window.addEventListener('keydown', async (e) => {
    // Don't capture shortcuts when terminal is focused
    const active = getActiveNodeId();
    const activeEntry = active ? getNode(active) : null;
    if (activeEntry?.type === 'terminal') return;

    // Cmd+P — new project node
    if (e.metaKey && !e.shiftKey && e.code === 'KeyP') {
      e.preventDefault();
      const selected = await open({ directory: true });
      if (typeof selected === 'string') {
        const viewX = (-world.x + window.innerWidth / 2) / world.scale.x - PROJECT_WIDTH / 2;
        const viewY = (-world.y + window.innerHeight / 2) / world.scale.y - PROJECT_HEIGHT / 2;
        const handle = createNode(world, viewX, viewY);
        await createProjectNode(handle.id, handle.gfx, PROJECT_WIDTH, PROJECT_HEIGHT, selected);
      }
    }

    // Cmd+Shift+T — new disconnected terminal
    if (e.metaKey && e.shiftKey && e.code === 'KeyT') {
      e.preventDefault();
      const viewX = (-world.x + window.innerWidth / 2) / world.scale.x - NODE_WIDTH / 2;
      const viewY = (-world.y + window.innerHeight / 2) / world.scale.y - NODE_HEIGHT / 2;
      const handle = createNode(world, viewX, viewY);
      await createTerminalNode(handle.id, handle.gfx, NODE_WIDTH, NODE_HEIGHT);
    }

    // Cmd+T — new terminal connected to project
    if (e.metaKey && !e.shiftKey && e.code === 'KeyT') {
      e.preventDefault();
      const projectNode = findTargetProject(world);
      if (projectNode) {
        const projPath = getProjectPath(projectNode.id);
        // Position to the right of the project node
        const termX = projectNode.gfx.x + projectNode.width + 50;
        const termY = projectNode.gfx.y;
        const handle = createNode(world, termX, termY);
        await createTerminalNode(handle.id, handle.gfx, NODE_WIDTH, NODE_HEIGHT, projPath, projPath);
        addConnection(handle.id, projectNode.id);
      } else {
        // No projects — create disconnected terminal at viewport center
        const viewX = (-world.x + window.innerWidth / 2) / world.scale.x - NODE_WIDTH / 2;
        const viewY = (-world.y + window.innerHeight / 2) / world.scale.y - NODE_HEIGHT / 2;
        const handle = createNode(world, viewX, viewY);
        await createTerminalNode(handle.id, handle.gfx, NODE_WIDTH, NODE_HEIGHT);
      }
    }
  });
```

Add the `findTargetProject` helper inside `main.ts`:

```typescript
import type { NodeEntry } from './state';

function findTargetProject(world: Container): NodeEntry | null {
  const projects = getNodesByType('project');
  if (projects.length === 0) return null;

  // If active node is a project, use it
  const activeId = getActiveNodeId();
  const activeEntry = activeId ? getNode(activeId) : null;
  if (activeEntry?.type === 'project') return activeEntry;

  // If exactly one project, use it
  if (projects.length === 1) return projects[0];

  // Find nearest to viewport center
  const vcx = (-world.x + window.innerWidth / 2) / world.scale.x;
  const vcy = (-world.y + window.innerHeight / 2) / world.scale.y;

  let nearest = projects[0];
  let nearestDist = Infinity;
  for (const p of projects) {
    const dx = p.gfx.x + p.width / 2 - vcx;
    const dy = p.gfx.y + p.height / 2 - vcy;
    const dist = dx * dx + dy * dy;
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = p;
    }
  }
  return nearest;
}
```

**Step 3: Update `src/terminal.ts` — `setActiveNode` should also clear project focus**

Import `blurAllProjectNodes` and call it when a terminal is focused:

In `terminal.ts` `setActiveNode`:

```typescript
import { setActiveProjectNode } from './project';
```

At the start of `setActiveNode`, if id is not null and it's a terminal, reset project borders:

```typescript
export function setActiveNode(id: string | null) {
  setActiveNodeId(id);
  // Reset project node borders when a terminal gets focus
  if (id !== null) {
    // This resets all project borders since we pass a non-project id
    setActiveProjectNode(null as unknown as string);
  }
  for (const data of terminalData.values()) {
    // ... existing logic
  }
}
```

Similarly, in `project.ts`, `setActiveProjectNode` should blur terminals:

```typescript
import { blurAllTerminals } from './terminal';

export function setActiveProjectNode(id: string | null) {
  setActiveNodeId(id);
  blurAllTerminals();
  for (const [pid, _data] of projectData) {
    const entry = getNode(pid);
    if (!entry) continue;
    if (pid === id) {
      entry.overlay.style.borderColor = BORDER_FOCUSED;
      entry.overlay.style.zIndex = `${getAllNodes().length + 1}`;
    } else {
      entry.overlay.style.borderColor = BORDER_DEFAULT;
    }
  }
}
```

Note: `blurAllTerminals` already exists in `terminal.ts` and calls `setActiveNode(null)`. We need to be careful about circular calls. Adjust `blurAllTerminals` to not call `setActiveProjectNode`:

```typescript
export function blurAllTerminals() {
  for (const data of terminalData.values()) {
    data.terminal.blur();
    const entry = getNode(data.id);
    if (entry) entry.overlay.style.borderColor = BORDER_DEFAULT;
  }
}
```

And `setActiveNode` becomes:

```typescript
export function setActiveNode(id: string | null) {
  setActiveNodeId(id);
  for (const data of terminalData.values()) {
    const entry = getNode(data.id);
    if (!entry) continue;
    if (data.id === id) {
      data.terminal.focus();
      entry.overlay.style.borderColor = BORDER_FOCUSED;
      entry.overlay.style.zIndex = `${getAllNodes().length + 1}`;
    } else {
      data.terminal.blur();
      entry.overlay.style.borderColor = BORDER_DEFAULT;
    }
  }
}
```

**Step 4: Remove the old double-click-to-spawn from `main.ts`**

Remove the `lastClickTime` / double-click handler block since terminals are now created via keyboard shortcuts.

**Step 5: Verify shortcuts work**

```bash
npm run tauri:dev
```

Expected:
- `Cmd+P` → directory picker → project node appears
- `Cmd+T` with a project on canvas → terminal spawns to the right of the project, connected with SVG bezier curve, title bar shows project path, terminal cwd is the project directory
- `Cmd+Shift+T` → disconnected terminal at viewport center, no connection edge
- `Cmd+T` with no projects → disconnected terminal (same as `Cmd+Shift+T`)

**Step 6: Commit**

```bash
git add src/main.ts src/terminal.ts src/project.ts
git commit -m "feat: add Cmd+T/Cmd+Shift+T/Cmd+P shortcuts with auto-connection"
```

---

### Task 8: Read-only code viewer on double-click

**Files:**
- Create: `src/viewer.ts`
- Modify: `src/node.ts`
- Modify: `src/project.ts`
- Modify: `src/main.ts`

**Step 1: Add viewer constants to `src/node.ts`**

```typescript
export const VIEWER_WIDTH = 600;
export const VIEWER_HEIGHT = 500;
```

**Step 2: Create `src/viewer.ts`**

```typescript
// src/viewer.ts
import { invoke } from '@tauri-apps/api/core';
import type { Graphics } from 'pixi.js';
import { TITLE_BAR_HEIGHT } from './node';
import {
  registerNode,
  unregisterNode,
  getNode,
  setActiveNodeId,
  getActiveNodeId,
  getAllNodes,
  getOverlayContainer,
} from './state';

const BORDER_WIDTH = 2;
const CORNER_RADIUS = 8;
const BORDER_DEFAULT = '#0f3460';
const BORDER_FOCUSED = '#e94560';
const FILL_COLOR = '#16213e';
const TITLE_BAR_COLOR = '#0f2040';

const viewerData = new Map<string, { fileName: string }>();

export async function createViewerNode(
  id: string,
  gfx: Graphics,
  nodeWidth: number,
  nodeHeight: number,
  filePath: string,
  fileName: string,
): Promise<void> {
  const overlay = document.createElement('div');
  overlay.className = 'viewer-overlay';
  overlay.style.cssText = `
    position:absolute;
    pointer-events:auto;
    overflow:hidden;
    background:${FILL_COLOR};
    border:${BORDER_WIDTH}px solid ${BORDER_DEFAULT};
    border-radius:${CORNER_RADIUS}px;
    box-sizing:border-box;
  `;
  overlay.style.width = `${nodeWidth}px`;
  overlay.style.height = `${nodeHeight}px`;
  getOverlayContainer().appendChild(overlay);

  // Title bar
  const titleBar = document.createElement('div');
  titleBar.style.cssText = `
    width:100%;
    height:${TITLE_BAR_HEIGHT}px;
    background:${TITLE_BAR_COLOR};
    cursor:grab;
    border-radius:${CORNER_RADIUS - BORDER_WIDTH}px ${CORNER_RADIUS - BORDER_WIDTH}px 0 0;
    display:flex;
    align-items:center;
    padding:0 8px;
    gap:6px;
  `;

  // Drag grip
  const gripIcon = document.createElement('div');
  gripIcon.style.cssText = 'display:flex;align-items:center;';
  gripIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4a5568" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>`;
  titleBar.appendChild(gripIcon);

  // File name
  const titleLabel = document.createElement('div');
  titleLabel.style.cssText = 'flex:1;color:#8899aa;font-family:Menlo,Monaco,monospace;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  titleLabel.textContent = fileName;
  titleBar.appendChild(titleLabel);

  // Close button
  const closeBtn = document.createElement('div');
  closeBtn.style.cssText = 'display:flex;align-items:center;cursor:pointer;padding:2px;border-radius:4px;';
  closeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4a5568" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
  closeBtn.addEventListener('mouseenter', () => { closeBtn.querySelector('svg')!.style.stroke = '#e94560'; });
  closeBtn.addEventListener('mouseleave', () => { closeBtn.querySelector('svg')!.style.stroke = '#4a5568'; });
  closeBtn.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    destroyViewerNode(id);
    const parent = gfx.parent;
    if (parent) parent.removeChild(gfx);
  });
  titleBar.appendChild(closeBtn);
  overlay.appendChild(titleBar);

  // Code content area
  const codeContainer = document.createElement('div');
  codeContainer.style.cssText = `
    width:100%;
    height:calc(100% - ${TITLE_BAR_HEIGHT}px);
    overflow:auto;
    padding:12px;
    box-sizing:border-box;
  `;
  overlay.appendChild(codeContainer);

  // Load file contents
  try {
    const contents = await invoke<string>('read_file_contents', { path: filePath });
    const pre = document.createElement('pre');
    pre.style.cssText = `
      margin:0;
      font-family:Menlo,Monaco,"Courier New",monospace;
      font-size:13px;
      color:#e0e0e0;
      line-height:1.5;
      white-space:pre;
      tab-size:4;
    `;
    pre.textContent = contents;
    codeContainer.appendChild(pre);
  } catch {
    codeContainer.style.cssText += 'color:#e94560;font-size:12px;font-family:Menlo,monospace;';
    codeContainer.textContent = 'Failed to read file';
  }

  // Title bar drag
  let dragging = false;
  let dragStartWorldX = 0;
  let dragStartWorldY = 0;
  let gfxStartX = 0;
  let gfxStartY = 0;

  titleBar.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const parent = gfx.parent;
    if (parent) parent.setChildIndex(gfx, parent.children.length - 1);
    setActiveViewerNode(id);
    dragging = true;
    titleBar.style.cursor = 'grabbing';
    dragStartWorldX = e.clientX;
    dragStartWorldY = e.clientY;
    gfxStartX = gfx.x;
    gfxStartY = gfx.y;
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const scale = gfx.parent?.scale.x ?? 1;
    gfx.x = gfxStartX + (e.clientX - dragStartWorldX) / scale;
    gfx.y = gfxStartY + (e.clientY - dragStartWorldY) / scale;
  });

  window.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      titleBar.style.cursor = 'grab';
    }
  });

  codeContainer.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    const parent = gfx.parent;
    if (parent) parent.setChildIndex(gfx, parent.children.length - 1);
    setActiveViewerNode(id);
  });

  registerNode({
    id,
    type: 'terminal', // Reuse type for now — viewer is lightweight
    gfx,
    overlay,
    width: nodeWidth,
    height: nodeHeight,
  });
  viewerData.set(id, { fileName });
}

function setActiveViewerNode(id: string) {
  setActiveNodeId(id);
  const entry = getNode(id);
  if (entry) {
    entry.overlay.style.borderColor = BORDER_FOCUSED;
    entry.overlay.style.zIndex = `${getAllNodes().length + 1}`;
  }
}

function destroyViewerNode(id: string) {
  const entry = getNode(id);
  if (entry) entry.overlay.remove();
  viewerData.delete(id);
  unregisterNode(id);
}
```

**Step 3: Wire double-click in `src/project.ts`**

Add a callback parameter to `createProjectNode` for file open events. Or simpler: emit a custom DOM event on double-click.

In `project.ts`, where file rows are created (the `else` branch for non-directory entries), add:

```typescript
      row.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const event = new CustomEvent('open-file-viewer', {
          detail: { filePath: entry.path, fileName: entry.name },
        });
        window.dispatchEvent(event);
      });
```

**Step 4: Handle the event in `src/main.ts`**

Add import:

```typescript
import { createViewerNode } from './viewer';
import { VIEWER_WIDTH, VIEWER_HEIGHT } from './node';
```

Inside `init()`:

```typescript
  // Open file viewer on double-click from project tree
  window.addEventListener('open-file-viewer', async (e) => {
    const { filePath, fileName } = (e as CustomEvent).detail;
    // Position near viewport center
    const viewX = (-world.x + window.innerWidth / 2) / world.scale.x - VIEWER_WIDTH / 2;
    const viewY = (-world.y + window.innerHeight / 2) / world.scale.y - VIEWER_HEIGHT / 2;
    const handle = createNode(world, viewX, viewY);
    await createViewerNode(handle.id, handle.gfx, VIEWER_WIDTH, VIEWER_HEIGHT, filePath, fileName);
  });
```

**Step 5: Add viewer CSS to `src/style.css`**

```css
/* Viewer node overlays */
.viewer-overlay {
  isolation: isolate;
  background: #16213e;
}

.viewer-overlay pre {
  user-select: text;
  -webkit-user-select: text;
}

.viewer-overlay::-webkit-scrollbar {
  width: 6px;
}

.viewer-overlay::-webkit-scrollbar-track {
  background: transparent;
}

.viewer-overlay::-webkit-scrollbar-thumb {
  background: #2a3a4a;
  border-radius: 3px;
}
```

**Step 6: Verify viewer works**

```bash
npm run tauri:dev
```

Expected: Create a project node (`Cmd+P`), expand a folder, double-click a file. A viewer node appears at viewport center showing the file contents in monospace text. Drag the viewer by its title bar. Close it with the close button.

**Step 7: Commit**

```bash
git add src/viewer.ts src/node.ts src/project.ts src/main.ts src/style.css
git commit -m "feat: add read-only code viewer node on file double-click"
```

---

## Summary

| Task | What it does | Key files |
|------|-------------|-----------|
| 1 | Centralize state management | `state.ts`, `terminal.ts`, `main.ts` |
| 2 | Optional `cwd` on `spawn_pty` | `pty.rs`, `terminal.ts` |
| 3 | Rust project commands + deps | `project.rs`, `lib.rs`, `Cargo.toml` |
| 4 | Project node frontend rendering | `project.ts`, `node.ts`, `main.ts`, `style.css` |
| 5 | File watcher integration | `watcher.rs`, `lib.rs`, `project.ts` |
| 6 | SVG connection layer | `connection.ts`, `main.ts` |
| 7 | Keyboard shortcuts + auto-connection | `main.ts`, `terminal.ts`, `project.ts` |
| 8 | Read-only code viewer | `viewer.ts`, `node.ts`, `project.ts`, `main.ts`, `style.css` |
