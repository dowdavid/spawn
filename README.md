# Spawn

A native macOS app that replaces traditional window management with an infinite canvas. Terminals, file trees, code editors, and browser previews live as connected nodes you can pan, zoom, and wire together.

Open a project, spawn a terminal, start a dev server, and a browser preview auto-appears, all on one canvas.

## Download

[Download Spawn for macOS (Apple Silicon)](https://github.com/dowdavid/spawn/releases/download/v0.1.0/Spawn_0.1.0_aarch64.dmg)

## Installation

1. Open the downloaded `.dmg` file
2. Drag **Spawn** into your Applications folder
3. On first launch, macOS will block the app because it isn't signed with an Apple Developer certificate. To open it:
   - Right-click (or Control-click) Spawn in Applications
   - Click **Open**
   - Click **Open** again in the dialog that appears
   - You only need to do this once. After that it opens normally.

Alternatively: System Settings > Privacy & Security > scroll down to "Spawn was blocked" > click **Open Anyway**.

## Getting started

1. Open Spawn
2. Press `Cmd+P` to create a project node and pick a folder
3. Press `Cmd+T` to spawn a terminal (auto-connects to the project)
4. Run a dev server in the terminal. When it prints a `localhost:PORT` URL, a browser preview auto-appears and connects

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+P` | New project node |
| `Cmd+T` | New terminal (connected to project) |
| `Cmd+Shift+T` | New standalone terminal |
| `Cmd+B` | New browser (paired with terminal) |
| `Cmd+Shift+B` | New standalone browser |
| `Cmd+W` | Close active node |
| `Cmd+S` | Save active editor |
| `Cmd+Q` | Save workspace and quit |

## Canvas controls

- **Pan:** Middle-click drag or Space + drag
- **Zoom:** Scroll wheel / trackpad pinch (0.1x to 5.0x, cursor-anchored)

## Node types

| Type | Color | Description |
|------|-------|-------------|
| Terminal | Red `#e94560` | xterm.js shell backed by a native PTY |
| Project | Purple `#a78bfa` | File tree explorer with lazy-loaded directories |
| Editor | Blue `#60a5fa` | CodeMirror text editor with syntax highlighting |
| Viewer | Green `#34d399` | Read-only file preview |
| Browser | Orange `#f59e0b` | URL bar + Tauri child webview for dev server previews |

## Connections

Nodes connect via drag-to-connect handles (glowing circles on node edges). Valid connections:

```
terminal <-> project    (1:1)
terminal <-> browser    (1:1)
project  <-> viewer     (1:many)
```

When a terminal detects a running dev server (parses `localhost:PORT` from PTY output), a browser node auto-spawns and connects.

## Workspace persistence

State auto-saves on quit and restores on launch. Saved to `~/.app_data/workspace.json`. Includes node positions, sizes, connections, terminal working directories, browser URLs, and open file paths.

---

## Development

### Stack

- **Frontend:** TypeScript, PixiJS 8 (WebGL canvas), xterm.js (terminals), CodeMirror 6 (editors)
- **Backend:** Rust, Tauri 2.0 (native shell, PTY, file I/O, webviews)
- **Build:** Vite 7, TypeScript 5

### Prerequisites

- macOS
- Node.js 20+
- Rust 1.77+
- [Tauri CLI prerequisites](https://v2.tauri.app/start/prerequisites/)

### Setup

```bash
npm install
```

### Run locally

```bash
npm run tauri:dev
```

Starts Vite on port 5173 and launches the Tauri window with hot reload.

### Production build

```bash
npm run tauri:build
```

Output lands in `src-tauri/target/release/bundle/`.

### Project structure

```
src/                     Frontend (TypeScript)
  main.ts                App init, shortcuts, event wiring
  state.ts               Node/connection registry, validation rules
  canvas.ts              PixiJS setup, pan, zoom
  node.ts                Geometry constants per node type
  terminal.ts            xterm.js terminal nodes
  project.ts             File tree, directory watcher
  editor.ts              CodeMirror editor nodes
  viewer.ts              Read-only file preview
  browser.ts             Browser preview + child webview
  connection.ts          SVG bezier curves between nodes
  nodule.ts              Drag-to-connect handles
  resize.ts              8-point resize handles
  persistence.ts         Workspace save/load
  theme.ts               Design tokens (colors, type, spacing)
  style.css              Global styles

src-tauri/src/           Backend (Rust)
  lib.rs                 Tauri setup, command registration
  main.rs                Entry point
  pty.rs                 PTY management, dev server URL detection
  project.rs             File system read/write
  watcher.rs             File system change notifications
  workspace.rs           Workspace persistence (~/.app_data/workspace.json)
  browser_webview.rs     Child webview management

docs/plans/              Design docs and roadmap
```
