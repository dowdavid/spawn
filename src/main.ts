import { Application, FederatedPointerEvent } from 'pixi.js';
import type { Container } from 'pixi.js';
import { open } from '@tauri-apps/plugin-dialog';
import { createCanvas } from './canvas';
import { createNode, NODE_WIDTH, NODE_HEIGHT, PROJECT_WIDTH, PROJECT_HEIGHT } from './node';
import {
  initOverlayContainer,
  getActiveNodeId,
  getNode,
  getNodesByType,
  addConnection,
  type NodeEntry,
} from './state';
import {
  createTerminalNode,
  syncOverlays,
  blurAllTerminals,
} from './terminal';
import { createProjectNode, getProjectPath } from './project';
import { initConnectionLayer, syncConnections } from './connection';
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
  initConnectionLayer();

  const world = createCanvas(app);

  // Click canvas background to blur all terminals
  app.stage.on('pointerdown', (event: FederatedPointerEvent) => {
    if (event.target === app.stage) {
      blurAllTerminals();
    }
  });

  // Overlay sync loop
  function syncLoop() {
    syncOverlays(world);
    syncConnections(world);
    requestAnimationFrame(syncLoop);
  }
  requestAnimationFrame(syncLoop);

  // Keyboard shortcuts
  window.addEventListener('keydown', async (e) => {
    // Don't capture shortcuts when terminal is focused
    const active = getActiveNodeId();
    const activeEntry = active ? getNode(active) : null;
    if (activeEntry?.type === 'terminal') return;

    // Cmd+Shift+T — new disconnected terminal (check BEFORE Cmd+T since Shift+T also matches T)
    if (e.metaKey && e.shiftKey && e.code === 'KeyT') {
      e.preventDefault();
      const viewX = (-world.x + window.innerWidth / 2) / world.scale.x - NODE_WIDTH / 2;
      const viewY = (-world.y + window.innerHeight / 2) / world.scale.y - NODE_HEIGHT / 2;
      const handle = createNode(world, viewX, viewY);
      await createTerminalNode(handle.id, handle.gfx, NODE_WIDTH, NODE_HEIGHT);
      return;
    }

    // Cmd+T — new terminal connected to project
    if (e.metaKey && !e.shiftKey && e.code === 'KeyT') {
      e.preventDefault();
      const projectNode = findTargetProject(world);
      if (projectNode) {
        const projPath = getProjectPath(projectNode.id);
        // Position to the right of the project node
        const termX = projectNode.gfx.x + projectNode.width + 50;
        const termY = projectNode.gfx.y;
        const handle = createNode(world, termX, termY);
        await createTerminalNode(handle.id, handle.gfx, NODE_WIDTH, NODE_HEIGHT, projPath, projPath);
        addConnection(handle.id, projectNode.id);
      } else {
        // No projects — create disconnected terminal at viewport center
        const viewX = (-world.x + window.innerWidth / 2) / world.scale.x - NODE_WIDTH / 2;
        const viewY = (-world.y + window.innerHeight / 2) / world.scale.y - NODE_HEIGHT / 2;
        const handle = createNode(world, viewX, viewY);
        await createTerminalNode(handle.id, handle.gfx, NODE_WIDTH, NODE_HEIGHT);
      }
      return;
    }

    // Cmd+P — new project node
    if (e.metaKey && !e.shiftKey && e.code === 'KeyP') {
      e.preventDefault();
      const selected = await open({ directory: true });
      if (typeof selected === 'string') {
        const viewX = (-world.x + window.innerWidth / 2) / world.scale.x - PROJECT_WIDTH / 2;
        const viewY = (-world.y + window.innerHeight / 2) / world.scale.y - PROJECT_HEIGHT / 2;
        const handle = createNode(world, viewX, viewY);
        await createProjectNode(handle.id, handle.gfx, PROJECT_WIDTH, PROJECT_HEIGHT, selected);
      }
      return;
    }
  });
}

function findTargetProject(world: Container): NodeEntry | null {
  const projects = getNodesByType('project');
  if (projects.length === 0) return null;

  // If active node is a project, use it
  const activeId = getActiveNodeId();
  const activeEntry = activeId ? getNode(activeId) : null;
  if (activeEntry?.type === 'project') return activeEntry;

  // If exactly one project, use it
  if (projects.length === 1) return projects[0];

  // Find nearest to viewport center
  const vcx = (-world.x + window.innerWidth / 2) / world.scale.x;
  const vcy = (-world.y + window.innerHeight / 2) / world.scale.y;

  let nearest = projects[0];
  let nearestDist = Infinity;
  for (const p of projects) {
    const dx = p.gfx.x + p.width / 2 - vcx;
    const dy = p.gfx.y + p.height / 2 - vcy;
    const dist = dx * dx + dy * dy;
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = p;
    }
  }
  return nearest;
}

init();
