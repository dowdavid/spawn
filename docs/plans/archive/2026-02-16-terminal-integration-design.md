# Terminal Integration Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Embed live terminal emulators (xterm.js) inside canvas nodes, backed by real PTY sessions managed by Tauri's Rust backend.

**Approach:** HTML overlay — each xterm.js instance is a DOM element positioned over the PixiJS canvas, synced to world coordinates via CSS transforms. Rust backend uses `portable-pty` for full interactive PTY support.

---

## Architecture

Three layers:

1. **Rust PTY backend** (`src-tauri/src/pty.rs`) — Manages PTY processes. Each node gets a PTY child process running the user's default shell. Tauri commands for spawn/write/resize/kill, events for output streaming.

2. **Frontend terminal manager** (`src/terminal.ts`) — Coordinates xterm.js instances, overlay DOM elements, focus state, and Tauri IPC wiring.

3. **HTML overlay system** — Absolutely positioned divs over the canvas, updated each frame via rAF to match world transforms. Hidden below 0.3x zoom.

---

## Rust PTY Backend

`PtyManager` struct holds `HashMap<String, PtySession>` behind a `Mutex`.

**Tauri commands:**
- `spawn_pty(id, cols, rows)` — Spawn PTY with user's `$SHELL` (fallback `/bin/zsh`). Background thread reads output → emits `pty-output` events.
- `write_pty(id, data)` — Write raw input to PTY.
- `resize_pty(id, cols, rows)` — Resize PTY (SIGWINCH).
- `kill_pty(id)` — Kill child process, clean up.

**Event flow:**
- Keystroke → `write_pty` → Rust → PTY master
- PTY output → reader thread → `pty-output` event → xterm.js `write()`

---

## Frontend Terminal & Overlay System

**On node creation:**
1. Create `<div>` with `position: absolute; pointer-events: auto`
2. Instantiate xterm.js `Terminal`, call `terminal.open(div)`
3. `invoke('spawn_pty', { id, cols, rows })`
4. Listen for `pty-output` events → `terminal.write(data)`
5. `terminal.onData()` → `invoke('write_pty', { id, data })`

**Overlay sync (rAF loop):**
- Each frame: update every overlay's `left`, `top`, `width`, `height` based on world transform
- Below 0.3x zoom: `display: none`

**Focus:**
- Click overlay → `terminal.focus()`, highlight node border
- Click canvas background → blur all terminals

---

## Changes to Existing Code

**`src/node.ts`:** Return overlay div + terminal references. Graphics rectangle is border frame only. Add cols/rows to NodeState.

**`src/main.ts`:** Import `@tauri-apps/api`. Create overlay container div. Wire double-click to also spawn PTY.

**`src/canvas.ts`:** World transform readable by overlay sync loop.

---

## New Dependencies

- `@xterm/xterm` + `@xterm/addon-fit` (terminal emulator + resize)
- `@tauri-apps/api` (frontend Tauri bindings)
- `portable-pty` (Rust PTY crate)
