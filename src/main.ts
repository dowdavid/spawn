import { Application, FederatedPointerEvent } from 'pixi.js';
import { open } from '@tauri-apps/plugin-dialog';
import { createCanvas } from './canvas';
import { createNode, NODE_WIDTH, NODE_HEIGHT, PROJECT_WIDTH, PROJECT_HEIGHT } from './node';
import { initOverlayContainer, getActiveNodeId, getNode } from './state';
import {
  createTerminalNode,
  syncOverlays,
  blurAllTerminals,
} from './terminal';
import { createProjectNode } from './project';
import '@xterm/xterm/css/xterm.css';

async function init() {
  const app = new Application();

  await app.init({
    background: '#1a1a2e',
    resizeTo: window,
    antialias: true,
    preference: 'webgl',
  });

  document.body.appendChild(app.canvas);
  initOverlayContainer();

  const world = createCanvas(app);

  // Spawn initial node
  const initial = createNode(world, 100, 100);
  await createTerminalNode(initial.id, initial.gfx, NODE_WIDTH, NODE_HEIGHT);

  // Double-click to spawn new nodes
  let lastClickTime = 0;
  app.stage.on('click', async (event: FederatedPointerEvent) => {
    const now = performance.now();
    if (now - lastClickTime < 300) {
      const worldX = (event.global.x - world.x) / world.scale.x;
      const worldY = (event.global.y - world.y) / world.scale.y;
      const handle = createNode(world, worldX, worldY);
      await createTerminalNode(handle.id, handle.gfx, NODE_WIDTH, NODE_HEIGHT);
      lastClickTime = 0;
    } else {
      lastClickTime = now;
    }
  });

  // Click canvas background to blur all terminals
  app.stage.on('pointerdown', (event: FederatedPointerEvent) => {
    if (event.target === app.stage) {
      blurAllTerminals();
    }
  });

  // Overlay sync loop
  function syncLoop() {
    syncOverlays(world);
    requestAnimationFrame(syncLoop);
  }
  requestAnimationFrame(syncLoop);

  // Keyboard shortcuts
  window.addEventListener('keydown', async (e) => {
    // Don't capture shortcuts when terminal is focused
    const active = getActiveNodeId();
    const activeEntry = active ? getNode(active) : null;
    if (activeEntry?.type === 'terminal') return;

    // Cmd+P — new project node
    if (e.metaKey && !e.shiftKey && e.code === 'KeyP') {
      e.preventDefault();
      const selected = await open({ directory: true });
      if (typeof selected === 'string') {
        const viewX = (-world.x + window.innerWidth / 2) / world.scale.x - PROJECT_WIDTH / 2;
        const viewY = (-world.y + window.innerHeight / 2) / world.scale.y - PROJECT_HEIGHT / 2;
        const handle = createNode(world, viewX, viewY);
        createProjectNode(handle.id, handle.gfx, PROJECT_WIDTH, PROJECT_HEIGHT, selected);
      }
    }
  });
}

init();
