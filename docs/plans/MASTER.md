# Spawn — Master Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Start from the **Active Step** section.

**Vision:** A native macOS infinite canvas workspace for developers — arrange terminals, project trees, code viewers, and browser previews as connected nodes on a zoomable PixiJS canvas.

**Tech Stack:** Tauri 2.0 (Rust), PixiJS v8 (WebGL), xterm.js, vanilla TypeScript, Vite

---

## Step 1: Scaffold — COMPLETED

Tauri 2.0 + Vite + TypeScript project with PixiJS infinite canvas. Pan (middle-mouse / space+drag), cursor-anchored zoom (0.1x–5.0x), draggable rectangle nodes, context menu suppression.

**Key files created:** `src/main.ts`, `src/canvas.ts`, `src/node.ts`, `src/style.css`, `src-tauri/`

---

## Step 2: Terminal Integration — COMPLETED

Live xterm.js terminals inside canvas nodes backed by Rust PTY sessions (`portable-pty`). HTML overlay system syncs DOM elements to world-space coordinates via rAF loop. Focus management with colored borders (red `#e94560` for active terminal).

**Key files created:** `src/terminal.ts`, `src-tauri/src/pty.rs`

**Rust commands:** `spawn_pty`, `write_pty`, `resize_pty`, `kill_pty`

---

## Step 3: Connections & Project Nodes — COMPLETED

Centralized state management (`state.ts`). Project nodes with lazy-loaded file trees and `notify`-based file watcher. SVG bezier connection edges (two layers: back/front for z-ordering). Keyboard shortcuts (`Cmd+T`, `Cmd+Shift+T`, `Cmd+P`, `Cmd+W`, `Cmd+Q`). Read-only code viewer nodes. Drag-to-connect nodules. 8-handle resize system with Tauri native cursors. Workspace persistence to JSON.

**Key files created:** `src/state.ts`, `src/project.ts`, `src/connection.ts`, `src/viewer.ts`, `src/nodule.ts`, `src/resize.ts`, `src/persistence.ts`, `src-tauri/src/project.rs`, `src-tauri/src/watcher.rs`, `src-tauri/src/workspace.rs`

**Node types:** terminal (red `#e94560`), project (purple `#a78bfa`), viewer (green `#34d399`)

**Rust commands:** `read_directory`, `read_file_contents`, `open_file_in_system`, `watch_directory`, `unwatch_directory`, `save_workspace`, `load_workspace`

---

## Step 4: Browser Nodes & Auto-Spawn — ACTIVE

### Design Summary

Add browser nodes with Tauri child webviews for previewing local dev servers. Terminals auto-detect running servers from PTY output and spawn a connected browser node.

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

### Architecture

Browser nodes follow the existing node pattern (PixiJS anchor + HTML overlay for title bar). Content area uses a native Tauri child webview (`@tauri-apps/api/webview`) positioned and sized to match the node's canvas bounds each frame. Dev server URLs are detected by string matching in the Rust PTY output handler and emitted as `dev-server-detected-{id}` events. The frontend auto-spawns browser nodes on detection, connecting them 1:1 to terminals.

**Note:** This project has no test infrastructure. Verification uses `npm run build` (TypeScript + Vite) and `cargo check` (Rust), plus manual testing with `npm run tauri:dev`.

---

### Task 1: Foundation — State Types, Node Constants, Resize & Nodule Mappings

Add 'browser' as a recognized node type across the shared infrastructure files.

**Files:**
- Modify: `src/state.ts:4`
- Modify: `src/node.ts:1-18`
- Modify: `src/resize.ts:1-29`
- Modify: `src/terminal.ts:36-39`
- Modify: `src/nodule.ts:10-21`

**Step 1: Add 'browser' to NodeType in `src/state.ts`**

```typescript
// Before:
export type NodeType = 'terminal' | 'project' | 'viewer';

// After:
export type NodeType = 'terminal' | 'project' | 'viewer' | 'browser';
```

**Step 2: Add browser size constants to `src/node.ts`**

After the VIEWER constants (line 11-12), add:

```typescript
export const BROWSER_WIDTH = 800;
export const BROWSER_HEIGHT = 600;

export const MIN_BROWSER_WIDTH = 400;
export const MIN_BROWSER_HEIGHT = 300;
```

**Step 3: Add browser to resize.ts mappings**

Update the import line to include `BROWSER_WIDTH, BROWSER_HEIGHT, MIN_BROWSER_WIDTH, MIN_BROWSER_HEIGHT`.

Add to `DEFAULT_SIZES`:
```typescript
browser: { w: BROWSER_WIDTH, h: BROWSER_HEIGHT },
```

Add to `MIN_SIZES`:
```typescript
browser: { w: MIN_BROWSER_WIDTH, h: MIN_BROWSER_HEIGHT },
```

**Step 4: Add browser to FOCUSED_BORDER_COLORS in `src/terminal.ts`**

```typescript
browser: '#f59e0b',
```

**Step 5: Add browser to `src/nodule.ts`**

Add to `NODULE_COLORS`:
```typescript
browser: '#f59e0b',
```

Add to `VALID_TARGETS`:
```typescript
browser: ['terminal'],
```

Update terminal entry:
```typescript
terminal: ['project', 'browser'],
```

**Step 6: Verify build**

Run: `cd /Users/daviddow/spawn && npm run build`
Expected: Build succeeds.

**Step 7: Commit**

```bash
git add src/state.ts src/node.ts src/resize.ts src/terminal.ts src/nodule.ts
git commit -m "feat: add browser node type to foundation (state, sizing, colors)"
```

---

### Task 2: Create browser.ts — HTML Overlay with Placeholder Content

Create the browser node module following the viewer.ts pattern. Title bar with globe icon, URL bar, refresh button, close button. Placeholder content area (webview added in Task 6).

**Files:**
- Create: `src/browser.ts`

**Step 1: Create `src/browser.ts`**

```typescript
import type { Graphics, Container } from 'pixi.js';
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
import { blurAllTerminals } from './terminal';
import { resetNodeSize, detachResizeFrame } from './resize';

export interface BrowserData {
  url: string;
  connectedTerminalId: string | null;
  urlLabel: HTMLDivElement;
  urlInput: HTMLInputElement;
  contentArea: HTMLDivElement;
  statusText: HTMLDivElement;
}

const browserData = new Map<string, BrowserData>();

const BORDER_WIDTH = 2;
const CORNER_RADIUS = 8;
const BORDER_DEFAULT = '#0f3460';
const FILL_COLOR = '#16213e';
const TITLE_BAR_COLOR = '#0f2040';
const ACCENT_COLOR = '#f59e0b';

export async function createBrowserNode(
  id: string,
  gfx: Graphics,
  nodeWidth: number,
  nodeHeight: number,
  url: string = '',
  connectedTerminalId: string | null = null,
): Promise<void> {
  const overlay = document.createElement('div');
  overlay.className = 'browser-overlay';
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
    gap:4px;
  `;

  // Drag grip
  const gripIcon = document.createElement('div');
  gripIcon.style.cssText = 'display:flex;align-items:center;';
  gripIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4a5568" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>`;
  titleBar.appendChild(gripIcon);

  // Globe icon (Lucide Globe)
  const typeIcon = document.createElement('div');
  typeIcon.className = 'node-type-icon';
  typeIcon.style.cssText = 'display:flex;align-items:center;';
  typeIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4a5568" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>`;
  titleBar.appendChild(typeIcon);

  // URL label (static text, click to edit)
  const urlLabel = document.createElement('div');
  urlLabel.style.cssText = 'flex:1;color:#8899aa;font-family:Menlo,Monaco,monospace;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:text;min-width:0;';
  urlLabel.textContent = url || 'Enter URL...';
  if (!url) urlLabel.style.color = '#4a5568';
  titleBar.appendChild(urlLabel);

  // URL input (hidden by default, shown on click)
  const urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.value = url;
  urlInput.placeholder = 'Enter URL...';
  urlInput.style.cssText = 'display:none;flex:1;background:#0a1628;border:1px solid #1a3a5c;border-radius:4px;color:#c0c8d0;font-family:Menlo,Monaco,monospace;font-size:11px;padding:2px 6px;outline:none;min-width:0;';
  titleBar.appendChild(urlInput);

  // Click URL label to switch to edit mode
  urlLabel.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    urlLabel.style.display = 'none';
    urlInput.style.display = 'block';
    urlInput.focus();
    urlInput.select();
  });

  // Enter to navigate, Escape to cancel
  urlInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const newUrl = urlInput.value.trim();
      commitUrl(id, newUrl);
      urlInput.style.display = 'none';
      urlLabel.style.display = 'block';
    } else if (e.key === 'Escape') {
      urlInput.value = browserData.get(id)?.url || '';
      urlInput.style.display = 'none';
      urlLabel.style.display = 'block';
    }
  });

  urlInput.addEventListener('blur', () => {
    urlInput.style.display = 'none';
    urlLabel.style.display = 'block';
  });

  // Refresh button (Lucide RotateCw)
  const refreshBtn = document.createElement('div');
  refreshBtn.style.cssText = 'display:flex;align-items:center;cursor:pointer;padding:2px;border-radius:4px;flex-shrink:0;';
  refreshBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4a5568" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>`;
  refreshBtn.addEventListener('mouseenter', () => { refreshBtn.querySelector('svg')!.style.stroke = ACCENT_COLOR; });
  refreshBtn.addEventListener('mouseleave', () => { refreshBtn.querySelector('svg')!.style.stroke = '#4a5568'; });
  refreshBtn.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    refreshBrowser(id);
  });
  titleBar.appendChild(refreshBtn);

  // Close button
  const closeBtn = document.createElement('div');
  closeBtn.style.cssText = 'display:flex;align-items:center;cursor:pointer;padding:2px;border-radius:4px;flex-shrink:0;';
  closeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4a5568" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
  closeBtn.addEventListener('mouseenter', () => { closeBtn.querySelector('svg')!.style.stroke = ACCENT_COLOR; });
  closeBtn.addEventListener('mouseleave', () => { closeBtn.querySelector('svg')!.style.stroke = '#4a5568'; });
  closeBtn.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    destroyBrowserNode(id);
    const parent = gfx.parent;
    if (parent) parent.removeChild(gfx);
  });
  titleBar.appendChild(closeBtn);

  overlay.appendChild(titleBar);

  // Content area — placeholder for now, webview added in Task 6
  const contentArea = document.createElement('div');
  contentArea.style.cssText = `
    width:100%;
    height:calc(100% - ${TITLE_BAR_HEIGHT}px);
    overflow:hidden;
    display:flex;
    align-items:center;
    justify-content:center;
    box-sizing:border-box;
  `;
  overlay.appendChild(contentArea);

  // Status text (shown when no URL or waiting for server)
  const statusText = document.createElement('div');
  statusText.style.cssText = 'color:#4a5568;font-family:Menlo,Monaco,monospace;font-size:13px;text-align:center;padding:20px;';
  statusText.textContent = url ? 'Loading...' : 'No URL — press Cmd+B or enter a URL above';
  contentArea.appendChild(statusText);

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
    blurAllTerminals();
    setActiveNodeId(id);
    overlay.style.zIndex = `${getAllNodes().length + 1}`;
    dragging = true;
    titleBar.style.cursor = 'grabbing';
    dragStartWorldX = e.clientX;
    dragStartWorldY = e.clientY;
    gfxStartX = gfx.x;
    gfxStartY = gfx.y;
  });

  titleBar.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    resetNodeSize(id);
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

  // Click content area to focus
  contentArea.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    const parent = gfx.parent;
    if (parent) parent.setChildIndex(gfx, parent.children.length - 1);
    blurAllTerminals();
    setActiveNodeId(id);
    overlay.style.zIndex = `${getAllNodes().length + 1}`;
  });

  browserData.set(id, { url, connectedTerminalId, urlLabel, urlInput, contentArea, statusText });

  registerNode({
    id,
    type: 'browser',
    gfx,
    overlay,
    width: nodeWidth,
    height: nodeHeight,
  });
}

function commitUrl(id: string, newUrl: string): void {
  const data = browserData.get(id);
  if (!data) return;
  data.url = newUrl;
  data.urlLabel.textContent = newUrl || 'Enter URL...';
  data.urlLabel.style.color = newUrl ? '#8899aa' : '#4a5568';
  data.urlInput.value = newUrl;
  if (newUrl) {
    data.statusText.textContent = 'Loading...';
    // Webview navigation added in Task 6
  } else {
    data.statusText.textContent = 'No URL — press Cmd+B or enter a URL above';
  }
}

export function refreshBrowser(id: string): void {
  const data = browserData.get(id);
  if (!data || !data.url) return;
  data.statusText.textContent = 'Refreshing...';
  // Webview reload added in Task 6
}

export function setBrowserUrl(id: string, url: string): void {
  commitUrl(id, url);
}

export function setActiveBrowserNode(id: string): void {
  blurAllTerminals();
  setActiveNodeId(id);
  const entry = getNode(id);
  if (!entry) return;
  entry.overlay.style.zIndex = `${getAllNodes().length + 1}`;
  const parent = entry.gfx.parent;
  if (parent) parent.setChildIndex(entry.gfx, parent.children.length - 1);
}

export function focusUrlInput(id: string): void {
  const data = browserData.get(id);
  if (!data) return;
  data.urlLabel.style.display = 'none';
  data.urlInput.style.display = 'block';
  data.urlInput.focus();
  data.urlInput.select();
}

export function getBrowserData(id: string): BrowserData | undefined {
  return browserData.get(id);
}

export function getBrowserForTerminal(terminalId: string): string | null {
  for (const [id, data] of browserData) {
    if (data.connectedTerminalId === terminalId) return id;
  }
  return null;
}

export function destroyBrowserNode(id: string): void {
  detachResizeFrame(id);
  const entry = getNode(id);
  if (entry) entry.overlay.remove();
  // Webview cleanup added in Task 6
  browserData.delete(id);
  unregisterNode(id);
}

// Webview sync — placeholder for Task 6
export function syncBrowserWebviews(_world: Container): void {
  // Will be implemented in Task 6 with Tauri child webviews
}
```

**Step 2: Verify build**

Run: `cd /Users/daviddow/spawn && npm run build`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add src/browser.ts
git commit -m "feat: create browser node HTML overlay with URL bar and placeholder"
```

---

### Task 3: Wire Up main.ts — Cmd+B Shortcut, Cmd+W Close, Imports

**Files:**
- Modify: `src/main.ts`

**Step 1: Add browser imports at the top of `src/main.ts`**

After the viewer import (line 28), add:

```typescript
import {
  createBrowserNode,
  destroyBrowserNode,
  setActiveBrowserNode,
  focusUrlInput,
  getBrowserForTerminal,
  setBrowserUrl,
  syncBrowserWebviews,
} from './browser';
```

Update the node.ts import (line 7) to include `BROWSER_WIDTH, BROWSER_HEIGHT`.

Add `listen` import:
```typescript
import { listen } from '@tauri-apps/api/event';
```

**Step 2: Add `syncBrowserWebviews` to sync loop**

In the `syncLoop` function (around line 97-102), add after `syncNoduleVisibility()`:

```typescript
syncBrowserWebviews(world);
```

**Step 3: Add Cmd+W handling for browser nodes**

In the Cmd+W handler (around line 124-138), after the viewer case, add:

```typescript
} else if (activeEntry.type === 'browser') {
  destroyBrowserNode(active);
}
```

**Step 4: Add Cmd+B shortcut**

After the Cmd+P handler block (before the closing `});` of the keydown listener), add:

```typescript
// Cmd+B — new browser node
if (e.metaKey && !e.shiftKey && e.code === 'KeyB') {
  e.preventDefault();

  const termId = (activeEntry?.type === 'terminal' && active) ? active
    : getLastActiveTerminalId();
  const termNode = termId ? getNode(termId) : null;

  if (termNode) {
    // Position to the right of the terminal
    const browserX = termNode.gfx.x + termNode.width + 50;
    const browserY = termNode.gfx.y;
    const handle = createNode(world, browserX, browserY);
    await createBrowserNode(handle.id, handle.gfx, BROWSER_WIDTH, BROWSER_HEIGHT, '', termId);
    attachNodule(handle.id);
    attachResizeFrame(handle.id);
    addConnection(handle.id, termId!);
    setActiveBrowserNode(handle.id);
    focusUrlInput(handle.id);
  } else {
    // No terminal — spawn disconnected at viewport center
    const viewX = (-world.x + window.innerWidth / 2) / world.scale.x - BROWSER_WIDTH / 2;
    const viewY = (-world.y + window.innerHeight / 2) / world.scale.y - BROWSER_HEIGHT / 2;
    const handle = createNode(world, viewX, viewY);
    await createBrowserNode(handle.id, handle.gfx, BROWSER_WIDTH, BROWSER_HEIGHT);
    attachNodule(handle.id);
    attachResizeFrame(handle.id);
    setActiveBrowserNode(handle.id);
    focusUrlInput(handle.id);
  }
  return;
}
```

**Step 5: Verify build**

Run: `cd /Users/daviddow/spawn && npm run build`
Expected: Build succeeds.

**Step 6: Manual test**

Run: `cd /Users/daviddow/spawn && npm run tauri:dev`
Test: Cmd+B creates browser node. Cmd+W closes it. URL input works.

**Step 7: Commit**

```bash
git add src/main.ts
git commit -m "feat: add Cmd+B shortcut and Cmd+W close for browser nodes"
```

---

### Task 4: Update Persistence for Browser Nodes

**Files:**
- Modify: `src/persistence.ts`

**Step 1: Add browser imports**

After the viewer import, add:
```typescript
import { createBrowserNode, getBrowserData } from './browser';
```

**Step 2: Add SerializedBrowser interface**

After `SerializedViewer`:
```typescript
interface SerializedBrowser {
  url: string;
  connectedTerminalId: string | null;
}
```

**Step 3: Update SerializedNode**

Update `type` to `'terminal' | 'project' | 'viewer' | 'browser'`. Add `browser?: SerializedBrowser`.

**Step 4: Add browser to `gatherWorkspaceState`**

After the viewer serialization block:
```typescript
} else if (entry.type === 'browser') {
  const bd = getBrowserData(entry.id);
  if (bd) {
    base.browser = {
      url: bd.url,
      connectedTerminalId: bd.connectedTerminalId,
    };
  }
}
```

**Step 5: Add browser to `restoreWorkspaceState`**

Add filter: `const browserNodes = state.nodes.filter((n) => n.type === 'browser');`

Add restore block after viewers:
```typescript
// Restore browsers
for (const n of browserNodes) {
  if (!n.browser) continue;
  const handle = createNodeWithId(world, n.x, n.y, n.id);
  await createBrowserNode(
    handle.id,
    handle.gfx,
    n.width,
    n.height,
    n.browser.url,
    n.browser.connectedTerminalId,
  );
}
```

**Step 6: Verify build**

Run: `cd /Users/daviddow/spawn && npm run build`

**Step 7: Commit**

```bash
git add src/persistence.ts
git commit -m "feat: add browser node workspace persistence"
```

---

### Task 5: Nodule Drag-to-Connect for Browser Nodes

**Files:**
- Modify: `src/nodule.ts`

**Step 1: Update `connectNodes` for browser-terminal connections**

In the `connectNodes` function (around line 187-208), add after existing cases:

```typescript
// If browser ↔ terminal, update browser's connectedTerminalId
if (source.type === 'browser' && target.type === 'terminal') {
  const { getBrowserData } = await import('./browser');
  const bd = getBrowserData(sourceId);
  if (bd) bd.connectedTerminalId = targetId;
} else if (source.type === 'terminal' && target.type === 'browser') {
  const { getBrowserData } = await import('./browser');
  const bd = getBrowserData(targetId);
  if (bd) bd.connectedTerminalId = sourceId;
}
```

Note: Dynamic import avoids circular dependency.

**Step 2: Make `connectNodes` async**

Change `function connectNodes(sourceId: string, targetId: string)` to `async function connectNodes(...)`.

**Step 3: Verify build**

Run: `cd /Users/daviddow/spawn && npm run build`

**Step 4: Manual test**

Test: Create terminal + browser, drag nodule to connect, verify nodule disappears.

**Step 5: Commit**

```bash
git add src/nodule.ts
git commit -m "feat: handle browser-terminal connections in nodule drag-to-connect"
```

---

### Task 6: Tauri Child Webview Integration

The core task — replace placeholder with a real Tauri child webview.

**Files:**
- Modify: `src-tauri/Cargo.toml:24`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src/browser.ts`

**Step 1: Enable Tauri unstable feature**

In `src-tauri/Cargo.toml`, change:
```toml
tauri = { version = "2.10.0", features = ["unstable"] }
```

**Step 2: Add webview permissions**

In `src-tauri/capabilities/default.json`, add to `permissions`:
```json
"core:webview:default",
"core:webview:allow-create-webview",
"core:webview:allow-set-webview-position",
"core:webview:allow-set-webview-size",
"core:webview:allow-webview-show",
"core:webview:allow-webview-hide",
"core:webview:allow-webview-close",
"core:webview:allow-set-webview-focus",
"core:window:allow-set-cursor-icon"
```

**Step 3: Verify Rust build**

Run: `cd /Users/daviddow/spawn/src-tauri && cargo check`

**Step 4: Update `src/browser.ts` with webview management**

Add imports:
```typescript
import { Webview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi';
```

Add webview map:
```typescript
const webviews = new Map<string, Webview>();
```

In `createBrowserNode`, after storing browserData and registering the node, add webview creation when URL exists:

```typescript
const data = browserData.get(id)!;
if (url) {
  try {
    const label = `browser-${id.replace(/[^a-zA-Z0-9-_]/g, '-')}`;
    const webview = new Webview(getCurrentWindow(), label, {
      url,
      x: 0, y: 0,
      width: nodeWidth,
      height: nodeHeight - TITLE_BAR_HEIGHT,
    });
    webviews.set(id, webview);
    webview.once('tauri://created', () => {
      webview.hide();
    });
    data.statusText.textContent = '';
  } catch (e) {
    console.warn('Failed to create webview:', e);
    if (url.includes('localhost') || url.includes('127.0.0.1')) {
      data.statusText.textContent = 'Waiting for server...';
    } else {
      data.statusText.textContent = 'Failed to load page';
    }
  }
}
```

Update `commitUrl` to create/navigate webviews:

```typescript
function commitUrl(id: string, newUrl: string): void {
  const data = browserData.get(id);
  if (!data) return;
  data.url = newUrl;
  data.urlLabel.textContent = newUrl || 'Enter URL...';
  data.urlLabel.style.color = newUrl ? '#8899aa' : '#4a5568';
  data.urlInput.value = newUrl;

  const existingWebview = webviews.get(id);

  if (newUrl) {
    data.statusText.textContent = 'Loading...';
    if (existingWebview) {
      existingWebview.navigate(newUrl);
    } else {
      try {
        const label = `browser-${id.replace(/[^a-zA-Z0-9-_]/g, '-')}`;
        const webview = new Webview(getCurrentWindow(), label, {
          url: newUrl,
          x: 0, y: 0, width: 800, height: 600,
        });
        webviews.set(id, webview);
        webview.once('tauri://created', () => {
          webview.hide();
          data.statusText.textContent = '';
        });
      } catch (e) {
        console.warn('Failed to create webview:', e);
        data.statusText.textContent = 'Failed to create webview';
      }
    }
  } else {
    data.statusText.textContent = 'No URL — press Cmd+B or enter a URL above';
    if (existingWebview) {
      existingWebview.close();
      webviews.delete(id);
    }
  }
}
```

Update `refreshBrowser`:
```typescript
export function refreshBrowser(id: string): void {
  const data = browserData.get(id);
  if (!data || !data.url) return;
  const webview = webviews.get(id);
  if (webview) {
    webview.navigate(data.url);
  }
}
```

Update `destroyBrowserNode`:
```typescript
export function destroyBrowserNode(id: string): void {
  detachResizeFrame(id);
  const entry = getNode(id);
  if (entry) entry.overlay.remove();
  const webview = webviews.get(id);
  if (webview) {
    webview.close();
    webviews.delete(id);
  }
  browserData.delete(id);
  unregisterNode(id);
}
```

**Step 5: Implement `syncBrowserWebviews`**

Replace the placeholder with:

```typescript
const WEBVIEW_MIN_SCALE = 0.3;

export function syncBrowserWebviews(world: Container): void {
  const scale = world.scale.x;
  const worldX = world.x;
  const worldY = world.y;
  const activeId = getActiveNodeId();

  for (const [id, webview] of webviews) {
    const entry = getNode(id);
    if (!entry) continue;

    const isActive = id === activeId;

    // Hide webview when not active or zoomed out too far
    if (!isActive || scale < WEBVIEW_MIN_SCALE) {
      webview.hide().catch(() => {});
      const data = browserData.get(id);
      if (data && data.url && data.statusText.textContent === '') {
        data.statusText.textContent = data.url;
        data.statusText.style.color = '#4a5568';
      }
      continue;
    }

    // Active browser — position and show the webview
    const screenX = entry.gfx.x * scale + worldX;
    const screenY = entry.gfx.y * scale + worldY + TITLE_BAR_HEIGHT * scale;
    const screenW = entry.width * scale;
    const screenH = (entry.height - TITLE_BAR_HEIGHT) * scale;

    webview.setPosition(new LogicalPosition(screenX, screenY)).catch(() => {});
    webview.setSize(new LogicalSize(Math.max(1, screenW), Math.max(1, screenH))).catch(() => {});
    webview.show().catch(() => {});

    const data = browserData.get(id);
    if (data && data.statusText.textContent === data.url) {
      data.statusText.textContent = '';
    }
  }
}
```

**Step 6: Verify build**

Run: `cd /Users/daviddow/spawn && npm run build`

**Step 7: Manual test**

Cmd+B, enter `https://example.com`, verify webview appears. Pan/zoom. Click away to see placeholder. Click back to see live webview.

**Step 8: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/capabilities/default.json src/browser.ts
git commit -m "feat: integrate Tauri child webview into browser nodes"
```

---

### Task 7: Dev Server Detection in Rust PTY Handler

**Files:**
- Modify: `src-tauri/src/pty.rs`

**Step 1: Add URL detection function**

At the bottom of `pty.rs`:

```rust
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
            let url_end = rest.find(|c: char| c.is_whitespace() || c == '"' || c == '\'' || c == '>' || c == ')' || c == ']')
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
```

**Step 2: Update PTY reader thread**

In `spawn_pty`, replace the reader thread with:

```rust
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
```

**Step 3: Verify Rust build**

Run: `cd /Users/daviddow/spawn/src-tauri && cargo check`

**Step 4: Commit**

```bash
git add src-tauri/src/pty.rs
git commit -m "feat: detect dev server URLs in PTY output and emit events"
```

---

### Task 8: Auto-Spawn Browser on Dev Server Detection

**Files:**
- Modify: `src/terminal.ts`
- Modify: `src/main.ts`

**Step 1: Add detected URL tracking to `src/terminal.ts`**

Add to `TerminalNodeData` interface:
```typescript
detectedUrl?: string;
```

Add exported functions:
```typescript
export function getTerminalDetectedUrl(id: string): string | undefined {
  return terminalData.get(id)?.detectedUrl;
}

export function setTerminalDetectedUrl(id: string, url: string): void {
  const data = terminalData.get(id);
  if (data) data.detectedUrl = url;
}
```

At the end of `createTerminalNode`, add:
```typescript
window.dispatchEvent(new CustomEvent('register-terminal-listener', {
  detail: { terminalId: id },
}));
```

**Step 2: Listen for dev-server-detected events in `src/main.ts`**

Add imports: `setTerminalDetectedUrl, getTerminalDetectedUrl` from terminal.ts.

After the workspace restore block, add:

```typescript
// Auto-spawn browser on dev server detection
window.addEventListener('register-terminal-listener', async (e) => {
  const { terminalId } = (e as CustomEvent).detail;
  await listen<string>(`dev-server-detected-${terminalId}`, async (event) => {
    const url = event.payload;
    setTerminalDetectedUrl(terminalId, url);

    const existingBrowserId = getBrowserForTerminal(terminalId);
    if (existingBrowserId) {
      setBrowserUrl(existingBrowserId, url);
    } else {
      const termNode = getNode(terminalId);
      if (!termNode) return;

      const browserX = termNode.gfx.x + termNode.width + 50;
      const browserY = termNode.gfx.y;
      const handle = createNode(world, browserX, browserY);
      await createBrowserNode(handle.id, handle.gfx, BROWSER_WIDTH, BROWSER_HEIGHT, url, terminalId);
      attachNodule(handle.id);
      attachResizeFrame(handle.id);
      addConnection(handle.id, terminalId);
    }
  });
});
```

**Step 3: Update Cmd+B to use detected URL**

In the Cmd+B handler, replace the empty URL with:
```typescript
const detectedUrl = termId ? (getTerminalDetectedUrl(termId) || '') : '';
```

And pass `detectedUrl` instead of `''` to `createBrowserNode`. Only call `focusUrlInput` when `!detectedUrl`.

**Step 4: Verify build**

Run: `cd /Users/daviddow/spawn && npm run build`

**Step 5: Manual test**

Open project, create terminal, run `npm run dev`. Browser should auto-spawn showing the dev server.

**Step 6: Commit**

```bash
git add src/terminal.ts src/main.ts
git commit -m "feat: auto-spawn browser nodes on dev server detection"
```

---

### Task 9: Final Polish — Terminal Cleanup and Edge Cases

**Files:**
- Modify: `src/main.ts`

**Step 1: Destroy connected browser when terminal is closed**

In the Cmd+W handler, before `await destroyTerminalNode(active);`, add:

```typescript
const connectedBrowserId = getBrowserForTerminal(active);
if (connectedBrowserId) {
  const browserEntry = getNode(connectedBrowserId);
  destroyBrowserNode(connectedBrowserId);
  if (browserEntry) {
    const browserParent = browserEntry.gfx.parent;
    if (browserParent) browserParent.removeChild(browserEntry.gfx);
  }
}
```

**Step 2: Verify build**

Run: `cd /Users/daviddow/spawn && npm run build`

**Step 3: Full integration test**

1. Open project, create terminal, run dev server → browser auto-spawns
2. Close terminal (Cmd+W) → browser also closes
3. Create browser with Cmd+B → enter URL → webview loads
4. Pan/zoom → webview follows
5. Cmd+Q → relaunch → browser restores
6. Drag browser nodule to terminal → connects

**Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat: clean up browser on terminal close"
```

---

## Future Steps

| Step | Features | Priority |
|------|----------|----------|
| 5 | Editor nodes (edit files on canvas) | High |
| 6 | Enhanced keyboard nav (Tab cycle, Cmd+Enter fullscreen, Cmd+K palette, / search) | High |
| 7 | Canvas persistence (save/load workspaces as files) | Medium |
| 8 | Pages (multiple pages within canvas) | Medium |
| 9 | Extensions API (third-party nodes) | Low |



| Future | Collaboration (shared canvas) | Low |
