import { Application, FederatedPointerEvent } from 'pixi.js';
import type { Container } from 'pixi.js';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createCanvas } from './canvas';
import { createNode, NODE_WIDTH, NODE_HEIGHT, PROJECT_WIDTH, PROJECT_HEIGHT, VIEWER_WIDTH, VIEWER_HEIGHT } from './node';
import {
  initOverlayContainer,
  getActiveNodeId,
  getNode,
  getNodesByType,
  getLastActiveTerminalId,
  addConnection,
  type NodeEntry,
} from './state';
import {
  createTerminalNode,
  destroyTerminalNode,
  setActiveNode,
  syncOverlays,
  blurAllTerminals,
} from './terminal';
import { createProjectNode, destroyProjectNode, getProjectPath } from './project';
import { createViewerNode, destroyViewerNode } from './viewer';
import { initConnectionLayer, syncConnections } from './connection';
import { gatherWorkspaceState, restoreWorkspaceState } from './persistence';
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

  // Restore saved workspace if one exists
  try {
    const json = await invoke<string | null>('load_workspace');
    if (json) {
      const state = JSON.parse(json);
      await restoreWorkspaceState(state, world);
    }
  } catch (e) {
    console.warn('Failed to restore workspace:', e);
  }

  // Save workspace helper
  async function saveWorkspace() {
    try {
      const state = gatherWorkspaceState(world);
      await invoke('save_workspace', { state: JSON.stringify(state) });
    } catch (e) {
      console.warn('Failed to save workspace:', e);
    }
  }

  // Save workspace on window close
  let isClosing = false;
  getCurrentWindow().onCloseRequested(async (event) => {
    if (isClosing) return;
    isClosing = true;
    event.preventDefault();
    await saveWorkspace();
    getCurrentWindow().destroy();
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
    syncConnections(world);
    requestAnimationFrame(syncLoop);
  }
  requestAnimationFrame(syncLoop);

  // Keyboard shortcuts
  window.addEventListener('keydown', async (e) => {
    // Let normal keystrokes through to focused terminals, but allow Cmd+ combos
    const active = getActiveNodeId();
    const activeEntry = active ? getNode(active) : null;
    if (activeEntry?.type === 'terminal' && !e.metaKey) return;

    // Cmd+Q — save workspace then close the app
    if (e.metaKey && !e.shiftKey && e.code === 'KeyQ') {
      e.preventDefault();
      if (!isClosing) {
        isClosing = true;
        await saveWorkspace();
        getCurrentWindow().destroy();
      }
      return;
    }

    // Cmd+W — close active node
    if (e.metaKey && !e.shiftKey && e.code === 'KeyW') {
      e.preventDefault();
      if (!activeEntry || !active) return;
      const gfx = activeEntry.gfx;
      if (activeEntry.type === 'terminal') {
        await destroyTerminalNode(active);
      } else if (activeEntry.type === 'project') {
        await destroyProjectNode(active);
      } else if (activeEntry.type === 'viewer') {
        destroyViewerNode(active);
      }
      const parent = gfx.parent;
      if (parent) parent.removeChild(gfx);
      return;
    }

    // Cmd+Shift+T — new disconnected terminal (check BEFORE Cmd+T since Shift+T also matches T)
    if (e.metaKey && e.shiftKey && e.code === 'KeyT') {
      e.preventDefault();
      const lastTermId = getLastActiveTerminalId();
      const lastTerm = lastTermId ? getNode(lastTermId) : null;
      const viewX = lastTerm
        ? lastTerm.gfx.x + 40
        : (-world.x + window.innerWidth / 2) / world.scale.x - NODE_WIDTH / 2;
      const viewY = lastTerm
        ? lastTerm.gfx.y + 40
        : (-world.y + window.innerHeight / 2) / world.scale.y - NODE_HEIGHT / 2;
      const handle = createNode(world, viewX, viewY);
      await createTerminalNode(handle.id, handle.gfx, NODE_WIDTH, NODE_HEIGHT);
      setActiveNode(handle.id);
      return;
    }

    // Cmd+T — new terminal connected to project
    if (e.metaKey && !e.shiftKey && e.code === 'KeyT') {
      e.preventDefault();
      const projectNode = findTargetProject(world);
      const lastTermId = getLastActiveTerminalId();
      const lastTerm = lastTermId ? getNode(lastTermId) : null;

      if (projectNode) {
        const projPath = getProjectPath(projectNode.id);
        // Stack right of last terminal with a visible horizontal offset, or right of project
        const STACK_OFFSET_X = 60;
        const STACK_OFFSET_Y = 30;
        const termX = lastTerm
          ? lastTerm.gfx.x + STACK_OFFSET_X
          : projectNode.gfx.x + projectNode.width + 50;
        const termY = lastTerm
          ? lastTerm.gfx.y + STACK_OFFSET_Y
          : projectNode.gfx.y;
        const handle = createNode(world, termX, termY);
        await createTerminalNode(handle.id, handle.gfx, NODE_WIDTH, NODE_HEIGHT, projPath, projPath);
        addConnection(handle.id, projectNode.id);
        setActiveNode(handle.id);
      } else {
        // No projects — stack from last terminal or use viewport center
        const viewX = lastTerm
          ? lastTerm.gfx.x + 40
          : (-world.x + window.innerWidth / 2) / world.scale.x - NODE_WIDTH / 2;
        const viewY = lastTerm
          ? lastTerm.gfx.y + 40
          : (-world.y + window.innerHeight / 2) / world.scale.y - NODE_HEIGHT / 2;
        const handle = createNode(world, viewX, viewY);
        await createTerminalNode(handle.id, handle.gfx, NODE_WIDTH, NODE_HEIGHT);
        setActiveNode(handle.id);
      }
      return;
    }

    // Cmd+P — new project node
    if (e.metaKey && !e.shiftKey && e.code === 'KeyP') {
      e.preventDefault();
      const lastTermId = getLastActiveTerminalId();
      const lastTerm = lastTermId ? getNode(lastTermId) : null;

      const selected = await open({ directory: true });
      if (typeof selected === 'string') {
        // Position next to the last-used terminal if one exists, otherwise viewport center
        const projX = lastTerm
          ? lastTerm.gfx.x - PROJECT_WIDTH - 50
          : (-world.x + window.innerWidth / 2) / world.scale.x - PROJECT_WIDTH / 2;
        const projY = lastTerm
          ? lastTerm.gfx.y
          : (-world.y + window.innerHeight / 2) / world.scale.y - PROJECT_HEIGHT / 2;
        const handle = createNode(world, projX, projY);
        await createProjectNode(handle.id, handle.gfx, PROJECT_WIDTH, PROJECT_HEIGHT, selected);
        if (lastTerm) {
          addConnection(lastTermId!, handle.id);
        }
      }
      return;
    }
  });

  // Open file viewer on double-click from project tree
  window.addEventListener('open-file-viewer', async (e) => {
    const { filePath, fileName } = (e as CustomEvent).detail;
    const viewX = (-world.x + window.innerWidth / 2) / world.scale.x - VIEWER_WIDTH / 2;
    const viewY = (-world.y + window.innerHeight / 2) / world.scale.y - VIEWER_HEIGHT / 2;
    const handle = createNode(world, viewX, viewY);
    await createViewerNode(handle.id, handle.gfx, VIEWER_WIDTH, VIEWER_HEIGHT, filePath, fileName);
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
