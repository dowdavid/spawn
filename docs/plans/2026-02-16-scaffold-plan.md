# Canvas Terminal Scaffold — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Scaffold a Tauri 2.0 app with a PixiJS infinite canvas supporting pan/zoom and draggable rectangle nodes.

**Architecture:** Tauri 2.0 serves a Vite+TypeScript frontend. PixiJS renders a full-window WebGL canvas. A single Container acts as the "world" layer — pan/zoom transform it, and all nodes are children. Nodes are Graphics objects with pointer-event-based dragging.

**Tech Stack:** Tauri 2.0 (Rust), PixiJS v8 (WebGL), Vanilla TypeScript, Vite

---

### Task 1: Scaffold Tauri project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.ts`
- Create: `src/style.css`
- Create: `src-tauri/` (entire directory via `tauri init`)

**Step 1: Initialize npm project and install dependencies**

```bash
cd /Users/daviddow/spawn
npm init -y
npm install pixi.js
npm install -D @tauri-apps/cli typescript vite
```

**Step 2: Create vite.config.ts**

```typescript
// vite.config.ts
import { defineConfig } from 'vite';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: 'ws', host, port: 1421 }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target:
      process.env.TAURI_ENV_PLATFORM == 'windows'
        ? 'chrome105'
        : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2021",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

**Step 4: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Canvas Terminal</title>
    <link rel="stylesheet" href="/src/style.css" />
  </head>
  <body>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

**Step 5: Create src/style.css**

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #1a1a2e;
}
```

**Step 6: Create minimal src/main.ts**

```typescript
console.log('Canvas Terminal starting...');
```

**Step 7: Update package.json scripts**

Add to `package.json`:
```json
{
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build"
  }
}
```

**Step 8: Initialize Tauri**

```bash
cd /Users/daviddow/spawn
npx tauri init
```

When prompted:
- App name: `canvas-terminal`
- Window title: `Canvas Terminal`
- Web assets relative path: `../dist`
- Dev server URL: `http://localhost:5173`
- Frontend dev command: `npm run dev`
- Frontend build command: `npm run build`

**Step 9: Update tauri.conf.json window config**

Edit `src-tauri/tauri.conf.json` to set the window:
```json
{
  "app": {
    "windows": [
      {
        "title": "Canvas Terminal",
        "width": 1280,
        "height": 800,
        "resizable": true,
        "fullscreen": false
      }
    ]
  }
}
```

**Step 10: Verify it builds and runs**

```bash
cd /Users/daviddow/spawn
npm run tauri:dev
```

Expected: A Tauri window opens showing a dark background. Browser console shows "Canvas Terminal starting...".

**Step 11: Commit**

```bash
git add -A
git commit -m "feat: scaffold Tauri 2.0 + Vite + TypeScript project"
```

---

### Task 2: PixiJS canvas with background

**Files:**
- Modify: `src/main.ts`

**Step 1: Write src/main.ts with PixiJS Application**

```typescript
import { Application } from 'pixi.js';

async function init() {
  const app = new Application();

  await app.init({
    background: '#1a1a2e',
    resizeTo: window,
    antialias: true,
    preference: 'webgl',
  });

  document.body.appendChild(app.canvas);
}

init();
```

**Step 2: Verify it runs**

```bash
npm run tauri:dev
```

Expected: Tauri window shows a dark `#1a1a2e` canvas filling the entire window. Resizing the window resizes the canvas.

**Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat: add PixiJS canvas with full-window WebGL rendering"
```

---

### Task 3: World container with pan

**Files:**
- Create: `src/canvas.ts`
- Modify: `src/main.ts`

**Step 1: Create src/canvas.ts with world container and pan**

```typescript
import { Application, Container, FederatedPointerEvent } from 'pixi.js';

export function createCanvas(app: Application) {
  const world = new Container({ isRenderGroup: true });
  app.stage.addChild(world);

  // Make stage interactive for pan events
  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;

  // Update hit area on resize
  window.addEventListener('resize', () => {
    app.stage.hitArea = app.screen;
  });

  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let isSpaceDown = false;

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') isSpaceDown = true;
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') isSpaceDown = false;
  });

  app.stage.on('pointerdown', (event: FederatedPointerEvent) => {
    // Middle mouse or Space+left click
    if (event.button === 1 || (event.button === 0 && isSpaceDown)) {
      isPanning = true;
      panStartX = event.global.x - world.x;
      panStartY = event.global.y - world.y;
      event.stopPropagation();
    }
  });

  app.stage.on('pointermove', (event: FederatedPointerEvent) => {
    if (isPanning) {
      world.x = event.global.x - panStartX;
      world.y = event.global.y - panStartY;
    }
  });

  app.stage.on('pointerup', () => {
    isPanning = false;
  });

  app.stage.on('pointerupoutside', () => {
    isPanning = false;
  });

  return world;
}
```

**Step 2: Update src/main.ts to use canvas**

```typescript
import { Application } from 'pixi.js';
import { createCanvas } from './canvas';

async function init() {
  const app = new Application();

  await app.init({
    background: '#1a1a2e',
    resizeTo: window,
    antialias: true,
    preference: 'webgl',
  });

  document.body.appendChild(app.canvas);

  const world = createCanvas(app);
}

init();
```

**Step 3: Verify panning works**

```bash
npm run tauri:dev
```

Expected: Middle-mouse drag moves the world. Space+left-drag also pans. (Nothing visible to pan yet, but the container moves — verifiable in next task when nodes exist.)

**Step 4: Commit**

```bash
git add src/canvas.ts src/main.ts
git commit -m "feat: add world container with pan (middle-mouse and space+drag)"
```

---

### Task 4: Add zoom to cursor

**Files:**
- Modify: `src/canvas.ts`

**Step 1: Add wheel zoom to createCanvas**

Add this block at the end of `createCanvas`, before the `return world`:

```typescript
  // Zoom
  const MIN_SCALE = 0.1;
  const MAX_SCALE = 5.0;

  app.canvas.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();

    const rect = app.canvas.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;

    // World position under cursor before zoom
    const worldBeforeX = (cursorX - world.x) / world.scale.x;
    const worldBeforeY = (cursorY - world.y) / world.scale.y;

    // Adjust scale
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, world.scale.x * factor));
    world.scale.set(newScale);

    // World position under cursor after zoom
    const worldAfterX = (cursorX - world.x) / world.scale.x;
    const worldAfterY = (cursorY - world.y) / world.scale.y;

    // Correct position so cursor stays over same world point
    world.x += (worldAfterX - worldBeforeX) * world.scale.x;
    world.y += (worldAfterY - worldBeforeY) * world.scale.y;
  }, { passive: false });
```

**Step 2: Verify zoom works**

```bash
npm run tauri:dev
```

Expected: Mouse wheel zooms in/out. Zoom is anchored to cursor position. Scale clamps between 0.1 and 5.0. (Again, fully verifiable once nodes exist in next task.)

**Step 3: Commit**

```bash
git add src/canvas.ts
git commit -m "feat: add cursor-anchored zoom with scale clamping"
```

---

### Task 5: Draggable rectangle node

**Files:**
- Create: `src/node.ts`
- Modify: `src/main.ts`

**Step 1: Create src/node.ts**

```typescript
import { Container, Graphics, FederatedPointerEvent } from 'pixi.js';

export interface NodeState {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const NODE_WIDTH = 400;
const NODE_HEIGHT = 300;
const CORNER_RADIUS = 8;
const FILL_COLOR = '#16213e';
const BORDER_COLOR = '#0f3460';

export function createNode(world: Container, x: number, y: number): NodeState {
  const id = crypto.randomUUID();

  const gfx = new Graphics()
    .roundRect(0, 0, NODE_WIDTH, NODE_HEIGHT, CORNER_RADIUS)
    .fill(FILL_COLOR)
    .stroke({ width: 2, color: BORDER_COLOR });

  gfx.x = x;
  gfx.y = y;
  gfx.eventMode = 'static';
  gfx.cursor = 'pointer';

  let dragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  gfx.on('pointerdown', (event: FederatedPointerEvent) => {
    if (event.button !== 0) return; // left click only

    dragging = true;
    const local = event.getLocalPosition(world);
    dragOffsetX = local.x - gfx.x;
    dragOffsetY = local.y - gfx.y;

    // Bring to front
    world.setChildIndex(gfx, world.children.length - 1);

    event.stopPropagation();
  });

  gfx.on('globalpointermove', (event: FederatedPointerEvent) => {
    if (!dragging) return;
    const local = event.getLocalPosition(world);
    gfx.x = local.x - dragOffsetX;
    gfx.y = local.y - dragOffsetY;
  });

  gfx.on('pointerup', () => {
    dragging = false;
  });

  gfx.on('pointerupoutside', () => {
    dragging = false;
  });

  world.addChild(gfx);

  return { id, x, y, width: NODE_WIDTH, height: NODE_HEIGHT };
}
```

**Step 2: Update src/main.ts — spawn on double-click**

```typescript
import { Application, FederatedPointerEvent } from 'pixi.js';
import { createCanvas } from './canvas';
import { createNode } from './node';

async function init() {
  const app = new Application();

  await app.init({
    background: '#1a1a2e',
    resizeTo: window,
    antialias: true,
    preference: 'webgl',
  });

  document.body.appendChild(app.canvas);

  const world = createCanvas(app);

  // Spawn initial node at center of world
  createNode(world, 100, 100);

  // Double-click to spawn new nodes
  app.stage.on('dblclick', (event: FederatedPointerEvent) => {
    const worldX = (event.global.x - world.x) / world.scale.x;
    const worldY = (event.global.y - world.y) / world.scale.y;
    createNode(world, worldX, worldY);
  });
}

init();
```

**Step 3: Verify everything works**

```bash
npm run tauri:dev
```

Expected:
- A dark rounded rectangle appears at (100, 100)
- Drag the rectangle with left-click — it moves smoothly
- Pan the canvas with middle-mouse or Space+left-drag
- Zoom with mouse wheel — zoom anchors to cursor, node scales with canvas
- Dragging works correctly at any zoom level
- Double-click empty space to spawn new nodes
- Clicking a node brings it to front (z-order)

**Step 4: Commit**

```bash
git add src/node.ts src/main.ts
git commit -m "feat: add draggable rectangle nodes with spawn on double-click"
```

---

### Task 6: Prevent context menu and polish interactions

**Files:**
- Modify: `src/canvas.ts`
- Modify: `src/style.css`

**Step 1: Suppress browser context menu on canvas**

Add to the end of `createCanvas`, before `return world`:

```typescript
  // Prevent browser context menu on canvas
  app.canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });
```

**Step 2: Update style.css to prevent text selection and set cursor**

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #1a1a2e;
  user-select: none;
  -webkit-user-select: none;
}

canvas {
  display: block;
}
```

**Step 3: Verify polish**

```bash
npm run tauri:dev
```

Expected: Right-click doesn't show context menu. No text selection artifacts during drag. Canvas has no scrollbars or gaps.

**Step 4: Commit**

```bash
git add src/canvas.ts src/style.css
git commit -m "feat: suppress context menu and polish canvas styles"
```

---

## Summary

| Task | What it does |
|------|-------------|
| 1 | Scaffold Tauri 2.0 + Vite + TypeScript project |
| 2 | PixiJS full-window canvas with WebGL |
| 3 | World container with pan (middle-mouse, space+drag) |
| 4 | Cursor-anchored zoom with scale clamping |
| 5 | Draggable rectangle nodes with spawn/z-order |
| 6 | Context menu suppression and interaction polish |

After this plan is complete, the app will have a working infinite canvas with draggable rectangles — ready for terminal node integration.
