# Editor Nodes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade viewer nodes to editable text editors for text files using CodeMirror 6, with auto-save and manual save.

**Architecture:** File type detected by extension at the `open-file-viewer` event in `main.ts`. Text files route to a new `editor.ts` module (CodeMirror 6). Non-text files keep the existing `viewer.ts` (read-only). Both register as `type: 'viewer'` in state to avoid connection rule changes. Persistence distinguishes them via an `isEditor` flag.

**Tech Stack:** CodeMirror 6, @codemirror/lang-javascript, @codemirror/lang-css, @codemirror/lang-html, @codemirror/lang-json, @codemirror/lang-markdown, @codemirror/theme-one-dark

---

### Task 1: Install CodeMirror dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install packages**

Run:
```bash
cd "/Users/daviddow/claude-brain/MVP's/pre-mvps/spawn"
npm install codemirror @codemirror/lang-javascript @codemirror/lang-css @codemirror/lang-html @codemirror/lang-json @codemirror/lang-markdown @codemirror/theme-one-dark
```

Expected: packages added to `dependencies` in `package.json`

**Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add CodeMirror 6 dependencies for editor nodes"
```

---

### Task 2: Add write_file_contents Tauri command

**Files:**
- Modify: `src-tauri/src/project.rs` (add new command after `read_file_contents`)
- Modify: `src-tauri/src/lib.rs` (register new command)

**Step 1: Add the Rust command**

In `src-tauri/src/project.rs`, add after the `read_file_contents` function:

```rust
#[tauri::command]
pub fn write_file_contents(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, &contents).map_err(|e| format!("Failed to write file: {}", e))
}
```

**Step 2: Register in lib.rs**

In `src-tauri/src/lib.rs`, add `project::write_file_contents` to the `generate_handler!` macro, after `project::read_file_contents`:

```rust
project::read_file_contents,
project::write_file_contents,
```

**Step 3: Verify it compiles**

Run:
```bash
cd "/Users/daviddow/claude-brain/MVP's/pre-mvps/spawn/src-tauri" && cargo check
```

Expected: compiles with no errors

**Step 4: Commit**

```bash
git add src-tauri/src/project.rs src-tauri/src/lib.rs
git commit -m "feat: add write_file_contents Tauri command"
```

---

### Task 3: Add editor color token to theme.ts

**Files:**
- Modify: `src/theme.ts`

**Step 1: Add the editor accent color**

In `src/theme.ts`, add a standalone constant after the `accent` record (line ~24). We can't add it to the `Record<NodeType, string>` since the editor still registers as `'viewer'` type in state.

```typescript
// Editor mode accent (used when viewer node is editable)
export const editorAccent = '#60a5fa';
```

**Step 2: Commit**

```bash
git add src/theme.ts
git commit -m "feat: add editor accent color token"
```

---

### Task 4: Create editor.ts module

This is the core task. Creates the CodeMirror-based editor node.

**Files:**
- Create: `src/editor.ts`

**Step 1: Create the editor module**

Create `src/editor.ts` with the full implementation:

```typescript
import { invoke } from '@tauri-apps/api/core';
import type { Graphics } from 'pixi.js';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { keymap } from '@codemirror/view';
import { TITLE_BAR_HEIGHT } from './node';
import {
  registerNode,
  unregisterNode,
  getNode,
  setActiveNodeId,
  getAllNodes,
  getOverlayContainer,
} from './state';
import { blurAllTerminals } from './terminal';
import { resetNodeSize, detachResizeFrame } from './resize';
import {
  borderWidth, cornerRadius, borderDefault, nodeBg, titleBarBg,
  editorAccent, textSecondary, textMuted, textError,
  fontMono, fontSizeBase,
  titleBarPadding, iconSize, closeBtnPadding, smallRadius,
} from './theme';

export interface EditorData {
  filePath: string;
  fileName: string;
  editorView: EditorView;
  dirty: boolean;
}

const editorData = new Map<string, EditorData>();
const recentWrites = new Map<string, number>(); // path -> timestamp for watcher loop prevention

function getLanguageExtension(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'ts': case 'tsx': return javascript({ typescript: true, jsx: ext === 'tsx' });
    case 'js': case 'jsx': return javascript({ jsx: ext === 'jsx' });
    case 'css': case 'scss': return css();
    case 'html': return html();
    case 'json': return json();
    case 'md': case 'markdown': return markdown();
    default: return [];
  }
}

async function saveFile(id: string): Promise<boolean> {
  const data = editorData.get(id);
  if (!data) return false;
  const contents = data.editorView.state.doc.toString();
  try {
    recentWrites.set(data.filePath, Date.now());
    await invoke('write_file_contents', { path: data.filePath, contents });
    data.dirty = false;
    updateTitleDirtyState(id);
    return true;
  } catch (err) {
    console.error('Failed to save file:', err);
    showSaveError(id);
    return false;
  }
}

function updateTitleDirtyState(id: string) {
  const data = editorData.get(id);
  if (!data) return;
  const entry = getNode(id);
  if (!entry) return;
  const label = entry.overlay.querySelector('.editor-title-label') as HTMLElement;
  if (label) {
    label.textContent = data.dirty ? `● ${data.fileName}` : data.fileName;
  }
}

function showSaveError(id: string) {
  const entry = getNode(id);
  if (!entry) return;
  const label = entry.overlay.querySelector('.editor-title-label') as HTMLElement;
  if (label) {
    const prev = label.style.color;
    label.style.color = textError;
    label.textContent = `⚠ Save failed`;
    setTimeout(() => {
      label.style.color = prev;
      updateTitleDirtyState(id);
    }, 2000);
  }
}

export async function createEditorNode(
  id: string,
  gfx: Graphics,
  nodeWidth: number,
  nodeHeight: number,
  filePath: string,
  fileName: string,
): Promise<void> {
  const overlay = document.createElement('div');
  overlay.className = 'editor-overlay';
  overlay.style.cssText = `
    position:absolute;
    pointer-events:auto;
    overflow:hidden;
    background:${nodeBg};
    border:${borderWidth}px solid ${borderDefault};
    border-radius:${cornerRadius}px;
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
    background:${titleBarBg};
    cursor:grab;
    border-radius:${cornerRadius - borderWidth}px ${cornerRadius - borderWidth}px 0 0;
    display:flex;
    align-items:center;
    padding:${titleBarPadding};
    gap:8px;
  `;

  // Drag grip
  const gripIcon = document.createElement('div');
  gripIcon.style.cssText = 'display:flex;align-items:center;';
  gripIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="${textMuted}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>`;
  titleBar.appendChild(gripIcon);

  // Edit icon (Lucide Pencil)
  const editIcon = document.createElement('div');
  editIcon.className = 'node-type-icon';
  editIcon.style.cssText = 'display:flex;align-items:center;';
  editIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="${textMuted}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/></svg>`;
  titleBar.appendChild(editIcon);

  // File name label
  const titleLabel = document.createElement('div');
  titleLabel.className = 'editor-title-label';
  titleLabel.style.cssText = `flex:1;color:${textSecondary};font-family:${fontMono};font-size:${fontSizeBase}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
  titleLabel.textContent = fileName;
  titleBar.appendChild(titleLabel);

  // Close button
  const closeBtn = document.createElement('div');
  closeBtn.style.cssText = `display:flex;align-items:center;cursor:pointer;padding:${closeBtnPadding}px;border-radius:${smallRadius}px;`;
  closeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="${textMuted}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
  closeBtn.addEventListener('mouseenter', () => { closeBtn.querySelector('svg')!.style.stroke = editorAccent; });
  closeBtn.addEventListener('mouseleave', () => { closeBtn.querySelector('svg')!.style.stroke = textMuted; });
  closeBtn.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    destroyEditorNode(id);
    const parent = gfx.parent;
    if (parent) parent.removeChild(gfx);
  });
  titleBar.appendChild(closeBtn);
  overlay.appendChild(titleBar);

  // Editor container
  const editorContainer = document.createElement('div');
  editorContainer.style.cssText = `
    width:100%;
    height:calc(100% - ${TITLE_BAR_HEIGHT}px);
    overflow:hidden;
    box-sizing:border-box;
  `;
  overlay.appendChild(editorContainer);

  // Auto-save debounce
  let autoSaveTimeout: ReturnType<typeof setTimeout> | null = null;

  // Load file and create CodeMirror
  let editorView: EditorView;
  try {
    const contents = await invoke<string>('read_file_contents', { path: filePath });

    const langExt = getLanguageExtension(fileName);

    editorView = new EditorView({
      state: EditorState.create({
        doc: contents,
        extensions: [
          basicSetup,
          oneDark,
          ...(Array.isArray(langExt) ? langExt : [langExt]),
          keymap.of([{
            key: 'Mod-s',
            run: () => { saveFile(id); return true; },
          }]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const data = editorData.get(id);
              if (data && !data.dirty) {
                data.dirty = true;
                updateTitleDirtyState(id);
              }
              if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
              autoSaveTimeout = setTimeout(() => saveFile(id), 1000);
            }
          }),
          EditorView.theme({
            '&': {
              height: '100%',
              fontSize: '15px',
            },
            '.cm-scroller': {
              overflow: 'auto',
              fontFamily: "Menlo,Monaco,'Courier New',monospace",
            },
            '.cm-content': {
              caretColor: editorAccent,
            },
            '&.cm-focused': {
              outline: 'none',
            },
          }),
        ],
      }),
      parent: editorContainer,
    });
  } catch {
    editorContainer.style.cssText += `color:${textError};font-size:${fontSizeBase}px;font-family:${fontMono};padding:16px;`;
    editorContainer.textContent = 'Failed to read file';
    // Register node anyway so it can be closed
    registerNode({ id, type: 'viewer', gfx, overlay, width: nodeWidth, height: nodeHeight });
    return;
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

  // Click editor area to focus node
  editorContainer.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    const parent = gfx.parent;
    if (parent) parent.setChildIndex(gfx, parent.children.length - 1);
    blurAllTerminals();
    setActiveNodeId(id);
    overlay.style.zIndex = `${getAllNodes().length + 1}`;
  });

  editorData.set(id, { filePath, fileName, editorView, dirty: false });

  registerNode({
    id,
    type: 'viewer',
    gfx,
    overlay,
    width: nodeWidth,
    height: nodeHeight,
  });
}

export function setActiveEditorNode(id: string): void {
  blurAllTerminals();
  setActiveNodeId(id);
  const entry = getNode(id);
  if (!entry) return;
  entry.overlay.style.zIndex = `${getAllNodes().length + 1}`;
  const parent = entry.gfx.parent;
  if (parent) parent.setChildIndex(entry.gfx, parent.children.length - 1);
}

export function getEditorData(id: string): EditorData | undefined {
  return editorData.get(id);
}

export function isEditorNode(id: string): boolean {
  return editorData.has(id);
}

/** Check if a file path was recently written by the editor (for watcher loop prevention). */
export function wasRecentlyWritten(filePath: string, windowMs: number = 2000): boolean {
  const ts = recentWrites.get(filePath);
  if (!ts) return false;
  if (Date.now() - ts < windowMs) return true;
  recentWrites.delete(filePath);
  return false;
}

export function destroyEditorNode(id: string) {
  const data = editorData.get(id);
  if (data) {
    data.editorView.destroy();
    editorData.delete(id);
  }
  detachResizeFrame(id);
  const entry = getNode(id);
  if (entry) entry.overlay.remove();
  unregisterNode(id);
}
```

**Step 2: Verify TypeScript compiles**

Run:
```bash
cd "/Users/daviddow/claude-brain/MVP's/pre-mvps/spawn" && npx tsc --noEmit
```

Expected: no type errors (may need adjustments based on exact CodeMirror type exports)

**Step 3: Commit**

```bash
git add src/editor.ts
git commit -m "feat: create editor module with CodeMirror 6 integration"
```

---

### Task 5: Add file type routing and wire up main.ts

**Files:**
- Modify: `src/main.ts` (import editor, route file opens, handle Cmd+W for editor nodes)

**Step 1: Add the TEXT_EXTENSIONS set and isTextFile helper**

At the top of `src/main.ts`, add imports from editor.ts and the file type check:

```typescript
import { createEditorNode, destroyEditorNode, setActiveEditorNode, isEditorNode, getEditorData } from './editor';
```

Add a helper function (before `init()`):

```typescript
const TEXT_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'css', 'scss', 'html', 'json',
  'md', 'txt', 'yaml', 'yml', 'toml', 'env', 'sh', 'rs',
  'py', 'go', 'sql', 'svg', 'xml',
]);

function isTextFile(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return TEXT_EXTENSIONS.has(ext);
}
```

**Step 2: Update the open-file-viewer event handler**

Replace the `open-file-viewer` handler (lines ~401-426 in `main.ts`) to route text files to the editor:

```typescript
  // Open file viewer/editor on double-click from project tree
  window.addEventListener('open-file-viewer', async (e) => {
    const { filePath, fileName, projectId } = (e as CustomEvent).detail;
    const projectNode = projectId ? getNode(projectId) : null;

    let viewX: number;
    let viewY: number;
    if (projectNode) {
      viewX = projectNode.gfx.x + PROJECT_WIDTH + 50;
      viewY = projectNode.gfx.y;
    } else {
      viewX = (-world.x + window.innerWidth / 2) / world.scale.x - VIEWER_WIDTH / 2;
      viewY = (-world.y + window.innerHeight / 2) / world.scale.y - VIEWER_HEIGHT / 2;
    }

    const handle = createNode(world, viewX, viewY);

    if (isTextFile(fileName)) {
      await createEditorNode(handle.id, handle.gfx, VIEWER_WIDTH, VIEWER_HEIGHT, filePath, fileName);
      attachNodule(handle.id);
      attachResizeFrame(handle.id);
      blurAllTerminals();
      setActiveEditorNode(handle.id);
    } else {
      await createViewerNode(handle.id, handle.gfx, VIEWER_WIDTH, VIEWER_HEIGHT, filePath, fileName);
      attachNodule(handle.id);
      attachResizeFrame(handle.id);
      blurAllTerminals();
      setActiveViewerNode(handle.id);
    }

    if (projectNode) {
      addConnection(handle.id, projectNode.id);
    }
  });
```

**Step 3: Update Cmd+W to handle editor nodes**

In the `Cmd+W` handler section (~line 186-211), update the viewer branch to also handle editors:

```typescript
      } else if (activeEntry.type === 'viewer') {
        if (isEditorNode(active)) {
          destroyEditorNode(active);
        } else {
          destroyViewerNode(active);
        }
```

**Step 4: Verify TypeScript compiles**

Run:
```bash
cd "/Users/daviddow/claude-brain/MVP's/pre-mvps/spawn" && npx tsc --noEmit
```

Expected: no type errors

**Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat: route text files to editor nodes, non-text to viewer"
```

---

### Task 6: Update persistence for editor nodes

**Files:**
- Modify: `src/persistence.ts`

**Step 1: Update imports**

Add editor imports to `src/persistence.ts`:

```typescript
import { createEditorNode, getEditorData, isEditorNode } from './editor';
```

**Step 2: Update SerializedViewer interface**

Add `isEditor` flag:

```typescript
interface SerializedViewer {
  filePath: string;
  fileName: string;
  isEditor?: boolean;
}
```

**Step 3: Update gatherWorkspaceState**

In the viewer branch of the gather loop (~line 95-99), check if the node is an editor:

```typescript
    } else if (entry.type === 'viewer') {
      const ed = getEditorData(entry.id);
      if (ed) {
        base.viewer = { filePath: ed.filePath, fileName: ed.fileName, isEditor: true };
      } else {
        const vd = getViewerData(entry.id);
        if (vd) {
          base.viewer = { filePath: vd.filePath, fileName: vd.fileName };
        }
      }
```

**Step 4: Update restoreWorkspaceState**

In the viewer restore section (~line 176-188), branch on `isEditor`:

```typescript
  // Restore viewers and editors
  for (const n of viewerNodes) {
    if (!n.viewer) continue;
    const handle = createNodeWithId(world, n.x, n.y, n.id);
    if (n.viewer.isEditor) {
      await createEditorNode(
        handle.id,
        handle.gfx,
        n.width,
        n.height,
        n.viewer.filePath,
        n.viewer.fileName,
      );
    } else {
      await createViewerNode(
        handle.id,
        handle.gfx,
        n.width,
        n.height,
        n.viewer.filePath,
        n.viewer.fileName,
      );
    }
  }
```

**Step 5: Verify TypeScript compiles**

Run:
```bash
cd "/Users/daviddow/claude-brain/MVP's/pre-mvps/spawn" && npx tsc --noEmit
```

**Step 6: Commit**

```bash
git add src/persistence.ts
git commit -m "feat: persist editor vs viewer nodes in workspace state"
```

---

### Task 7: Add active border color for editor nodes

The `syncOverlays` function in `src/terminal.ts` uses `accent[entry.type]` for active borders (lines 315-316) and icon stroke color (lines 322-323). Since editors register as `'viewer'` type, they'll get the green viewer border. We need the sync loop to check if it's an editor and use `editorAccent` instead.

**Files:**
- Modify: `src/terminal.ts:315-316,322-323` (border and icon color in `syncOverlays`)

**Step 1: Add imports to terminal.ts**

```typescript
import { isEditorNode } from './editor';
import { editorAccent } from './theme';
```

**Step 2: Update active border color (line 315-316)**

Replace:
```typescript
    entry.overlay.style.borderColor = isActive
      ? (accent[entry.type] || borderDefault)
      : borderDefault;
```

With:
```typescript
    const nodeAccent = (entry.type === 'viewer' && isEditorNode(entry.id)) ? editorAccent : accent[entry.type];
    entry.overlay.style.borderColor = isActive
      ? (nodeAccent || borderDefault)
      : borderDefault;
```

**Step 3: Update icon stroke color (line 322-323)**

Replace:
```typescript
      iconSvg.style.stroke = isActive
        ? (accent[entry.type] || textMuted)
        : textMuted;
```

With:
```typescript
      iconSvg.style.stroke = isActive
        ? (nodeAccent || textMuted)
        : textMuted;
```

**Step 2: Verify TypeScript compiles**

Run:
```bash
cd "/Users/daviddow/claude-brain/MVP's/pre-mvps/spawn" && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/terminal.ts
git commit -m "feat: use blue accent border for active editor nodes"
```

---

### Task 8: Build and manual test

**Step 1: Full build check**

Run:
```bash
cd "/Users/daviddow/claude-brain/MVP's/pre-mvps/spawn" && npm run build
```

Expected: builds with no errors

**Step 2: Run the app**

Run:
```bash
cd "/Users/daviddow/claude-brain/MVP's/pre-mvps/spawn" && npm run tauri:dev
```

**Manual test checklist:**
- [ ] Open a project node (Cmd+P)
- [ ] Double-click a `.ts` file → opens editor node with syntax highlighting
- [ ] Double-click a `.png` or other non-text file → opens read-only viewer
- [ ] Type in the editor → dirty dot (●) appears in title bar
- [ ] Wait 1 second → dot disappears (auto-saved)
- [ ] Make a change, press Cmd+S → saves immediately, dot clears
- [ ] Editor node shows blue border when active
- [ ] Viewer node shows green border when active
- [ ] Cmd+W closes editor nodes
- [ ] Close and reopen app → editor nodes restored correctly

**Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues from manual testing"
```
