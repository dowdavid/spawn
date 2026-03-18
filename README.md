# Spawn

A native macOS app that replaces traditional window management with an infinite canvas. Terminals, file trees, code editors, and browser previews live as connected nodes you can pan, zoom, and wire together.

Open a project, spawn a terminal, start a dev server, and a browser preview auto-appears, all on one canvas.

## Stack

- **Frontend:** TypeScript, PixiJS 8 (WebGL canvas), xterm.js (terminals), CodeMirror 6 (editors)
- **Backend:** Rust, Tauri 2.0 (native shell, PTY, file I/O, webviews)
- **Build:** Vite 7, TypeScript 5

## Prerequisites

- macOS (the only supported platform right now)
- Node.js 20+
- Rust 1.77+
- [Tauri CLI prerequisites](https://v2.tauri.app/start/prerequisites/)

## Setup

```bash
npm install
```

## Development

```bash
npm run tauri:dev
```

This starts Vite on port 5173 and launches the Tauri window with hot reload.

## Production build

```bash
npm run tauri:build
```

Output lands in `src-tauri/target/release/bundle/`.

## Node types

| Type | Color | Description |
|------|-------|-------------|
| Terminal | Red `#e94560` | xterm.js shell backed by a native PTY |
| Project | Purple `#a78bfa` | File tree explorer with lazy-loaded directories |
| Editor | Blue `#60a5fa` | CodeMirror text editor with syntax highlighting |
| Viewer | Green `#34d399` | Read-only file preview |
| Browser | Orange `#f59e0b` | URL bar + Tauri child webview for dev server previews |

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+T` | New terminal (connected to project) |
| `Cmd+Shift+T` | New disconnected terminal |
| `Cmd+P` | New project node |
| `Cmd+B` | New browser (paired with terminal) |
| `Cmd+Shift+B` | New disconnected browser |
| `Cmd+W` | Close active node |
| `Cmd+S` | Save active editor |
| `Cmd+Q` | Save workspace and quit |

## Canvas controls

- **Pan:** Middle-click drag or Space + drag
- **Zoom:** Scroll wheel / trackpad pinch (0.1x to 5.0x, cursor-anchored)

## How connections work

Nodes connect via drag-to-connect handles (glowing circles on node edges). Valid connections:

```
terminal <-> project    (1:1)
terminal <-> browser    (1:1)
project  <-> viewer     (1:many)
```

When a terminal detects a running dev server (parses `localhost:PORT` from PTY output), a browser node auto-spawns and connects.

## Project structure

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

## Workspace persistence

State auto-saves on quit and restores on launch. Saved to `~/.app_data/workspace.json`. Includes node positions, sizes, connections, terminal working directories, browser URLs, and open file paths.
