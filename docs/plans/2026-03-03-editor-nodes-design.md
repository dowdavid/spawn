# Editor Nodes — Design

> Upgrade viewer nodes to editable text editors for text files using CodeMirror 6.

## Overview

When a file is clicked in the project tree, text files open in an editor node (editable) instead of a viewer node (read-only). Non-text files (images, binaries) keep the existing read-only viewer behaviour. One node type, two modes.

## Editor Node

Same visual shell as other nodes: draggable title bar, 8-point resize, colored border. Blue `#60a5fa` border for editable files, green `#34d399` for read-only — tells you at a glance what you're looking at.

Title bar shows filename. Dirty state shows a dot before the name (`● main.ts`). Dot disappears on save.

Body is a CodeMirror 6 instance filling the node content area. Language mode detected from file extension. Day one languages: TypeScript, JavaScript, CSS, JSON, HTML, Markdown. `oneDark` theme to match the dark canvas.

**Save behaviour:**
- **Cmd+S** writes immediately via `write_file` Tauri command, clears dirty indicator
- **Auto-save** fires 1 second after last keystroke via debounced `write_file`, clears dirty indicator
- Both coexist — auto-save catches you, Cmd+S gives control

**Error handling:** if write fails (permissions, disk full, file deleted), show error state in title bar. Don't lose the buffer.

## File Type Routing

Extension check in the project node's file click handler.

**Editor (text files):** `.ts`, `.tsx`, `.js`, `.jsx`, `.css`, `.scss`, `.html`, `.json`, `.md`, `.txt`, `.yaml`, `.yml`, `.toml`, `.env`, `.sh`, `.rs`, `.py`, `.go`, `.sql`, `.svg`, `.xml`

**Viewer (everything else):** `.png`, `.jpg`, `.gif`, `.webp`, `.ico`, binaries, unknown extensions. Falls back to viewer if unsure — safer than guessing editable.

No new connection type. `Project → Viewer` connection stays at the state layer. The node checks the file extension on creation and mounts CodeMirror (text) or renders read-only preview (non-text).

## Backend: write_file Command

One new Tauri command in `project.rs`: `write_file`. Takes path and content string, writes to disk.

**Watcher loop prevention:** the existing `notify` watcher will fire when the editor writes. Tag editor writes with a short debounce window or flag so the editor doesn't reload its own changes.

Auto-save debounce lives on the frontend. CodeMirror's `updateListener` fires on every change — 1 second timeout that resets on each keystroke, calls `write_file` when settled.

## Integration

Project node's file click handler: text extension → `createEditorNode()`, otherwise existing viewer path.

Editor spawns positioned to the right of the project node, connected automatically. Same layout logic as current viewers.

Focus management: clicking into CodeMirror marks the editor node as active. Cmd+W closes it. Workspace persistence saves file path and scroll position (no need to persist unsaved content since auto-save handles it).

## Not In Scope

Find/replace, multiple cursors, tab management, split views, git diff indicators. All upgradeable later via CodeMirror extensions or Monaco swap.

## Dependencies

- `codemirror` (core)
- `@codemirror/lang-javascript` (JS/TS)
- `@codemirror/lang-css`
- `@codemirror/lang-html`
- `@codemirror/lang-json`
- `@codemirror/lang-markdown`
- `@codemirror/theme-one-dark`
