# Canvas Terminal — Step 2: Connections & Project Nodes — Design

## Overview

Building on the completed MVP (terminals on canvas with pan/zoom), this step adds **project nodes** (file trees linked to directories), **connections** between terminals and projects (SVG bezier curves), and **keyboard shortcuts** for node creation.

### Decisions Made

- **SVG overlay layer** for connection rendering (sits between PixiJS canvas and HTML overlays)
- **HTML overlays** for project nodes (consistent with terminal nodes)
- **No drag-to-connect gesture** — terminals connect at creation time via keyboard shortcuts
- **Lazy-loaded file trees** — first level on creation, expand on demand
- **Minimal styling** — `▶`/`▼` disclosure triangles, plain text, no file icons
- **PTY spawns with project `cwd`** — connected terminals start in the project directory
- **Disconnection deferred** to a future enhancement

---

## Architecture

### Layering (bottom to top)

1. PixiJS WebGL canvas (background, invisible anchors)
2. SVG connection layer (`z-index: 5`, `pointer-events: none`)
3. HTML overlay container (`z-index: 10`, terminal + project node cards)

### State Management

A centralized `state.ts` module holds all canvas state:

```typescript
interface CanvasState {
  nodes: Map<string, TerminalNodeState | ProjectNodeState>;
  connections: Map<string, Connection>;
}
```

Helper functions: `addNode`, `removeNode`, `addConnection`, `removeConnection`, `getConnectionsForNode`. All node creation flows go through this state.

### Data Model

```typescript
type NodeType = 'terminal' | 'project';

interface BaseNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TerminalNodeState extends BaseNode {
  type: 'terminal';
  connectedTo?: string;  // Project node ID
}

interface ProjectNodeState extends BaseNode {
  type: 'project';
  path: string;          // Absolute directory path
}

interface Connection {
  id: string;
  sourceId: string;      // Terminal node ID
  targetId: string;      // Project node ID
}
```

---

## Project Node — Rust Backend

### New commands (`src-tauri/src/project.rs`)

- **`read_directory(path, id)`** — Returns immediate children as `FileEntry` structs (`name`, `path`, `is_directory`). No nested children (lazy-loaded on expand).
- **`open_file(path)`** — Opens file in system default app.

### File watcher (`src-tauri/src/watcher.rs`)

- **`watch_directory(path, id)`** — Uses `notify-rs` to watch a directory. On create/modify/delete, emits `file-changed-{id}` Tauri event with the changed path and event kind.
- **`unwatch_directory(id)`** — Stops watching, cleans up.
- `WatcherManager` state holds active watchers keyed by project ID.

### Changes to existing code

- **`spawn_pty`** gets an optional `cwd: Option<String>` parameter. Connected terminals pass the project path, disconnected terminals pass `None` (defaults to home directory).

### New dependency

- `notify = "7"` in `Cargo.toml`

---

## Project Node — Frontend Rendering

### Sizing

Project nodes are **400px wide x 600px tall** — narrower and taller than terminal nodes (720x480). File trees are vertical content, so this shape fits naturally.

### Overlay structure

- Title bar: drag grip, folder name, close button (same pattern as terminals)
- File tree container below, scrollable

### File tree rendering

Plain HTML — a `<div>` per entry with indentation via left padding. Folders show `▶` (collapsed) or `▼` (expanded) as disclosure triangles. Files show plain text.

- Click folder → calls `read_directory` for that path, inserts child entries
- Double-click file → opens a read-only code viewer node (monospace `<pre>`, same HTML overlay pattern as other nodes)

### File watcher integration

- On project creation: calls `watch_directory`, listens for `file-changed-{id}` events
- On change event: re-fetches the affected subtree and re-renders
- On project close: calls `unwatch_directory`, removes listener

### Drag behavior

Reuses the same title-bar drag pattern from terminals.

---

## Connection System — SVG Rendering

### SVG layer

A `<svg>` element created at startup, positioned `fixed` over the full window. `z-index: 5` (between PixiJS canvas and HTML overlays). `pointer-events: none` so clicks pass through.

### Edge rendering

Each connection is a `<path>` element using a cubic bezier curve. Curves anchor at the **nearest edges** of the two nodes (not centers) — if a terminal is above a project, the curve goes from the terminal's bottom edge to the project's top edge.

### Sync loop

The existing `syncOverlays` function (called every frame via `requestAnimationFrame`) is extended to also update SVG paths. For each connection, it recalculates source and target screen positions from `gfx` world coordinates, applies scale/translate, and updates the path's `d` attribute.

### Styling

Connected edges: `2px solid`, subtle blue (`#4a9eff`, 0.6 opacity). Dashed/dimmed disconnected styling deferred to future disconnect feature.

---

## Keyboard Shortcuts

A single `keydown` listener on `window` handles all shortcuts, checking for `metaKey` (Cmd). Shortcuts are suppressed when a terminal has focus to avoid conflicts with shell keybindings.

| Shortcut | Action |
|----------|--------|
| `Cmd+P` | New project node (opens directory picker) |
| `Cmd+T` | New terminal connected to focused/nearest project |
| `Cmd+Shift+T` | New disconnected terminal |

### `Cmd+P` flow

1. Calls Rust `open_directory_dialog` (Tauri dialog plugin) to pick a folder
2. Creates project node centered in current viewport
3. Starts file watcher for that directory

### `Cmd+T` flow

1. Find target project (priority: focused project → only project → nearest to viewport center)
2. If no projects exist, falls through to disconnected behavior
3. Spawns terminal with `cwd` set to project path
4. Creates connection entry in state
5. Positions new terminal near the project node (offset right ~50px)

### `Cmd+Shift+T` flow

1. Spawns terminal with default home directory cwd
2. No connection entry
3. Positions at viewport center

### Connected terminal visual feedback

Title bar subtitle shows the project path (e.g. `~/my-project`).

---

## File Structure

```
src-tauri/
├── src/
│   ├── lib.rs          # Register new commands and state
│   ├── pty.rs          # Add optional cwd to spawn_pty
│   ├── project.rs      # NEW: read_directory, open_file
│   └── watcher.rs      # NEW: watch/unwatch_directory, WatcherManager
└── Cargo.toml          # Add: notify

src/
├── main.ts             # Keyboard shortcuts, init flow
├── canvas.ts           # Unchanged
├── node.ts             # Unchanged
├── terminal.ts         # Use state.ts, add cwd support
├── project.ts          # NEW: createProjectNode, file tree rendering
├── connection.ts       # NEW: SVG layer, edge rendering, sync
├── state.ts            # NEW: centralized CanvasState
└── viewer.ts           # NEW: read-only code viewer node
```

---

## Implementation Order

| Step | What | Verifiable outcome |
|------|------|--------------------|
| 1 | State management | `state.ts` with CanvasState, existing terminals migrated, app works as before |
| 2 | `spawn_pty` cwd support | Optional `cwd` param on Rust side, terminals still spawn normally |
| 3 | Project node rendering | `Cmd+P` opens picker, project node appears with file tree |
| 4 | File watcher | Create file in terminal, it appears in connected project tree |
| 5 | SVG connection layer | Bezier edges render between connected terminal/project pairs |
| 6 | Connected terminal creation | `Cmd+T`/`Cmd+Shift+T` work, connections auto-created |
| 7 | Code viewer on double-click | Double-click file in project tree opens read-only viewer node |

Each step gets its own commit.

---

## Non-Goals (Do NOT build yet)

- Browser nodes
- Auto-spawn behavior (detecting `npm run dev`, etc.)
- Full editor nodes (code viewer is read-only for now)
- Extensions / plugins
- Disconnect gesture
- Node resizing
- Persistence / save-restore
