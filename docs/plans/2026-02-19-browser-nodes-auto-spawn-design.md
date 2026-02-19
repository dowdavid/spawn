# Browser Nodes & Auto-Spawn Design

## Overview

Add a browser node type to the canvas for previewing local dev servers. Terminals auto-detect running servers from PTY output and spawn a connected browser node. Browser nodes use Tauri child webviews for true browser isolation.

## Browser Node — Structure & Rendering

The browser node follows the same pattern as terminal/project/viewer nodes: an invisible PixiJS anchor for world-space positioning, with an HTML overlay for the title bar and controls.

The main content area is a **Tauri child webview** (`Webview` from `@tauri-apps/api/webview`) positioned and sized to match the node's bounds on the canvas.

### Layout

- **Title bar** (HTML overlay, top ~36px): drag handle, type icon (globe, orange `#f59e0b` when active), URL display/input, refresh button
- **Content area** (Tauri child webview): fills remaining space below the title bar

### Sizing

- Default: 800x600px
- Minimum: 400x300px
- Resizable via existing resize system

### Sync

The existing `syncOverlays` loop (runs every rAF) positions HTML overlays in world-space. The browser node hooks into this same loop to reposition its child webview — setting `x`, `y`, `width`, `height` on the webview each frame as the canvas pans/zooms.

### Color Scheme

- Active border + icon: orange `#f59e0b`
- Follows the existing per-type color pattern (red=terminal, purple=project, green=viewer, orange=browser)

## Auto-Spawn — Detecting Dev Servers from Terminal Output

PTY output is already streamed via Tauri events (`pty-output-{id}`). A lightweight parser on the Rust side scans each output chunk for dev server URL patterns.

### Detection Patterns

Regex checked against each PTY output chunk:

- `https?://localhost:\d+`
- `https?://127\.0\.0\.1:\d+`
- `https?://0\.0\.0\.0:\d+` (mapped to `localhost`)

Covers Vite, Next.js, CRA, Webpack Dev Server, Django, Rails, Go, and virtually all dev servers that print a URL to stdout.

### Flow

1. Rust PTY output handler checks each chunk against the patterns
2. On match, emit a new Tauri event: `dev-server-detected-{terminal_id}` with the URL
3. Frontend listens for this event per terminal
4. If the terminal has no connected browser node: auto-spawn one
5. Browser positioned to the right of the terminal (+740px x, same y), auto-connected
6. If a browser IS already connected: update the URL and auto-refresh the webview

### Deduplication

Only the first URL match triggers a spawn. Subsequent output with the same URL is ignored. A different URL (e.g., server restarted on a new port) triggers a URL update + refresh on the existing browser.

### Restart Detection

When the terminal outputs a fresh URL match after a gap (e.g., Ctrl+C then re-run), the connected browser auto-refreshes.

## Connections & Cmd+B Shortcut

### Connection Rules

- Browser connects to a terminal. This is the primary connection for auto-spawn and auto-refresh.
- Browser-to-project connection is implicit through the terminal. No direct browser-to-project link needed.
- 1:1 relationship: one browser per terminal, one terminal per browser.

### Cmd+B Behavior (Smart Default)

1. If a terminal is active AND has a detected dev server URL: spawn a browser with that URL, auto-connect to the terminal, position to its right
2. If a terminal is active but no URL detected: spawn a browser with an empty URL input focused, auto-connect to the terminal
3. If no terminal is active: spawn a disconnected browser at viewport center with the URL input focused

### URL Input Bar

- Lives in the title bar, right of the globe icon
- Shows the current URL as static text normally
- Click to edit: becomes an input field, Enter to navigate
- When no URL is set, shows placeholder: "Enter URL..."

### Refresh Button

- Circular arrow icon in the title bar, right side
- Click to reload the webview

### Close

Cmd+W on browser node destroys the child webview and removes the node + connection, same pattern as closing a terminal.

## Webview Lifecycle & Canvas Sync

### Creating the Webview

- On browser node spawn, call Tauri's webview API to create a child webview with label `browser-{nodeId}`
- Initial URL: detected dev server URL, or `about:blank` if none
- Webview is chromeless (no native title bar or navigation controls)

### Layering

The webview is a native OS-level view that renders above all web content. To handle overlapping nodes:

- When a browser node is **not active**: hide the webview and show a **placeholder** in its place (page title + URL + colored rectangle as a lightweight stand-in)
- When the browser node is **active/focused**: show the live webview and bring it to front
- Same tradeoff VS Code makes with webview panels — only the focused one is truly live

### Resize Sync

- On resize, update webview position/size via Tauri's `setPosition`/`setSize` APIs
- Throttled to match existing resize throttle (100ms)

### Pan/Zoom Sync

- Every `syncOverlays` frame, compute screen-space bounds from world-space position + canvas transform
- Update webview position/size to match
- When zoomed below 0.3x scale, hide the webview entirely

## Persistence & State

### Workspace Serialization

Browser nodes serialize like other node types with browser-specific data:

- `id`, `type: "browser"`, `x`, `y`, `width`, `height`
- `url`: current URL loaded in the webview
- `connectedTerminalId`: linked terminal (if any)

### Restore Order

Browser nodes are recreated after terminals so connection targets exist. The webview is re-created and navigates to the saved URL.

### Waiting State

If the saved URL's dev server isn't running yet, the browser shows "Waiting for server..." in the content area. Once the terminal re-detects the URL, it auto-refreshes.

### Not Persisted

- Page scroll position, cookies, localStorage — each session starts fresh
- Navigation history — no back/forward, single-page preview only

## Summary

| Aspect | Decision |
|--------|----------|
| Webview tech | Tauri child webview (native, isolated) |
| Color | Orange `#f59e0b` |
| Auto-spawn | Parse PTY output for localhost URLs on Rust side |
| Refresh | Auto-refresh on server restart + manual refresh button |
| Cmd+B | Smart default: use active terminal's URL, or show URL input |
| Layering | Live webview when focused, placeholder when not |
| Connections | 1:1 browser-to-terminal |
| Persistence | Save URL + terminal connection, restore on load |
