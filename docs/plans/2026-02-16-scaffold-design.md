# Canvas Terminal — Scaffold Design

## Goal

Tauri 2.0 desktop app with a PixiJS infinite canvas. Users can spawn draggable rectangle nodes, pan/zoom the canvas, and move nodes around. This is the foundation for terminal nodes added later.

## Tech Stack

- **Backend:** Tauri 2.0 (Rust)
- **Frontend:** Vanilla TypeScript + Vite
- **Rendering:** PixiJS (WebGL)

## Project Structure

```
canvas-terminal/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs          # Tauri entry point
│   │   └── lib.rs           # Library root
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/
│   ├── main.ts              # Entry — inits PixiJS app
│   ├── canvas.ts            # Canvas setup, pan/zoom
│   ├── node.ts              # Draggable rectangle node
│   └── style.css            # Minimal reset
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## Canvas & Viewport

- PixiJS Application fills the window: `{ background: '#1a1a2e', resizeTo: window, antialias: true }`
- Single `Container` ("world") holds all nodes. Pan/zoom transform the world, not individual nodes.
- **Pan:** Middle-mouse drag or Space+left-drag. Track `isPanning`, `panStart`, apply delta on `pointermove`.
- **Zoom:** Mouse wheel scales world around cursor position. Adjust world `x`/`y` so point under cursor stays fixed. Clamp scale `0.1–5.0`.
- **Resize:** Window `resize` event calls `app.renderer.resize()`.

## Draggable Nodes

- `Graphics` object: rounded rectangle 400x300, radius 8, fill `#16213e`, border `#0f3460`.
- Child of world container — inherits pan/zoom automatically.
- `eventMode: 'static'`, `cursor: 'pointer'`.
- **Drag:** On `pointerdown`, record offset. On `pointermove`, update position divided by `world.scale.x` for zoom-correct dragging. On `pointerup`, clear flag.
- **Z-order:** Click brings node to top via `setChildIndex`.
- **Spawn:** Double-click on empty canvas creates node at world-space position: `worldX = (screenX - world.x) / world.scale.x`.

## Node State

```typescript
interface NodeState {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
```

Stored in `Map<string, NodeState>`. Becomes the persistence format later.

## Not In Scope

- Terminal emulation / PTY integration
- Rust backend commands
- Persistence / save-restore
- Project nodes, browser nodes, editor nodes
- Connections, auto-spawn, pages, extensions
