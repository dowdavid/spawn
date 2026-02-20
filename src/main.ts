import { Application, FederatedPointerEvent } from 'pixi.js';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createCanvas } from './canvas';
import { createNode, NODE_WIDTH, NODE_HEIGHT, PROJECT_WIDTH, PROJECT_HEIGHT, VIEWER_WIDTH, VIEWER_HEIGHT, BROWSER_WIDTH, BROWSER_HEIGHT } from './node';
import {
  initOverlayContainer,
  getActiveNodeId,
  setActiveNodeId,
  getNode,
  getAllNodes,
  getNodesByType,
  getLastActiveTerminalId,
  getLastActiveProjectId,
  addConnection,
  getConnectionsForNode,
  terminalHasProject,
  terminalHasBrowser,
  type NodeEntry,
} from './state';
import {
  createTerminalNode,
  destroyTerminalNode,
  setActiveNode,
  syncOverlays,
  blurAllTerminals,
  setTerminalProjectLabel,
  setTerminalDetectedUrl,
  getTerminalDetectedUrl,
  getTerminalData,
} from './terminal';
import { createProjectNode, destroyProjectNode, getProjectPath, setActiveProjectNode } from './project';
import { createViewerNode, destroyViewerNode, setActiveViewerNode } from './viewer';
import {
  createBrowserNode,
  destroyBrowserNode,
  setActiveBrowserNode,
  focusUrlInput,
  getBrowserForTerminal,
  getBrowserData,
  setBrowserUrl,
  syncBrowserWebviews,
} from './browser';
import { initConnectionLayer, syncConnections } from './connection';
import { attachNodule, syncNoduleVisibility } from './nodule';
import { attachResizeFrame, initResizeCursors } from './resize';
import { gatherWorkspaceState, restoreWorkspaceState } from './persistence';
import { canvasBg } from './theme';
import '@xterm/xterm/css/xterm.css';

async function init() {
  const app = new Application();

  await app.init({
    background: canvasBg,
    resizeTo: window,
    antialias: true,
    preference: 'webgl',
  });

  document.body.appendChild(app.canvas);
  initOverlayContainer();
  initConnectionLayer();
  initResizeCursors();

  const world = createCanvas(app);

  // Auto-spawn browser on dev server detection
  // Registered BEFORE workspace restore so restored terminals get listeners too
  const registeredTerminalListeners = new Set<string>();
  window.addEventListener('register-terminal-listener', (e) => {
    const { terminalId } = (e as CustomEvent).detail;
    if (registeredTerminalListeners.has(terminalId)) return;
    registeredTerminalListeners.add(terminalId);
    listen<string>(`dev-server-detected-${terminalId}`, async (event) => {
      const url = event.payload;
      setTerminalDetectedUrl(terminalId, url);

      const existingBrowserId = getBrowserForTerminal(terminalId);
      if (existingBrowserId) {
        setBrowserUrl(existingBrowserId, url);
      } else if (terminalHasBrowser(terminalId)) {
        // Terminal already has a browser via connection graph — skip
      } else {
        // Push to any unconnected browser node
        const emptyBrowser = findUnconnectedBrowser();
        if (emptyBrowser) {
          const conn = addConnection(emptyBrowser, terminalId);
          if (conn) {
            const bd = getBrowserData(emptyBrowser);
            if (bd) bd.connectedTerminalId = terminalId;
            setBrowserUrl(emptyBrowser, url);
          }
        } else {
          // No browser at all — auto-spawn one next to the terminal
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
      }
    }).catch((err) => console.warn('Failed to listen for dev-server-detected:', err));
  });

  // Restore saved workspace if one exists
  try {
    const json = await invoke<string | null>('load_workspace');
    if (json) {
      const state = JSON.parse(json);
      await restoreWorkspaceState(state, world);
      // Attach nodules and resize frames to all restored nodes
      for (const entry of getAllNodes()) {
        attachNodule(entry.id);
        attachResizeFrame(entry.id);
      }
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

  // Click canvas background to deactivate all nodes
  app.stage.on('pointerdown', (event: FederatedPointerEvent) => {
    if (event.target === app.stage) {
      blurAllTerminals();
      setActiveNodeId(null);
    }
  });

  // Overlay sync loop
  function syncLoop() {
    syncOverlays(world);
    syncConnections(world);
    syncNoduleVisibility();
    syncBrowserWebviews(world);
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
        const connectedBrowserId = getBrowserForTerminal(active);
        if (connectedBrowserId) {
          const browserEntry = getNode(connectedBrowserId);
          destroyBrowserNode(connectedBrowserId);
          if (browserEntry) {
            const browserParent = browserEntry.gfx.parent;
            if (browserParent) browserParent.removeChild(browserEntry.gfx);
          }
        }
        await destroyTerminalNode(active);
      } else if (activeEntry.type === 'project') {
        await destroyProjectNode(active);
      } else if (activeEntry.type === 'viewer') {
        destroyViewerNode(active);
      } else if (activeEntry.type === 'browser') {
        destroyBrowserNode(active);
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
      attachNodule(handle.id);
      attachResizeFrame(handle.id);
      setActiveNode(handle.id);
      return;
    }

    // Cmd+T — new terminal connected to project
    if (e.metaKey && !e.shiftKey && e.code === 'KeyT') {
      e.preventDefault();
      const projectNode = findTargetProject();
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
        attachNodule(handle.id);
        attachResizeFrame(handle.id);
        addConnection(handle.id, projectNode.id);
        setActiveNode(handle.id);
        await autoConnectBrowser(handle.id);
      } else {
        // No projects — position left of existing browser, or stack from last terminal, or viewport center
        const emptyBrowserEntry = findUnconnectedBrowser() ? getNode(findUnconnectedBrowser()!) : null;
        let viewX: number, viewY: number;
        if (emptyBrowserEntry) {
          viewX = emptyBrowserEntry.gfx.x - NODE_WIDTH - 50;
          viewY = emptyBrowserEntry.gfx.y;
        } else if (lastTerm) {
          viewX = lastTerm.gfx.x + 40;
          viewY = lastTerm.gfx.y + 40;
        } else {
          viewX = (-world.x + window.innerWidth / 2) / world.scale.x - NODE_WIDTH / 2;
          viewY = (-world.y + window.innerHeight / 2) / world.scale.y - NODE_HEIGHT / 2;
        }
        const handle = createNode(world, viewX, viewY);
        await createTerminalNode(handle.id, handle.gfx, NODE_WIDTH, NODE_HEIGHT);
        attachNodule(handle.id);
        attachResizeFrame(handle.id);
        setActiveNode(handle.id);
        await autoConnectBrowser(handle.id);
      }
      return;
    }

    // Cmd+P — new project node (only one allowed)
    if (e.metaKey && !e.shiftKey && e.code === 'KeyP') {
      e.preventDefault();
      const existingProjects = getNodesByType('project');
      if (existingProjects.length > 0) {
        setActiveProjectNode(existingProjects[0].id);
        return;
      }

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
        attachNodule(handle.id);
        attachResizeFrame(handle.id);
        // Reconnect terminals that were previously connected to this project path
        const projectName = selected.split('/').pop() || selected;
        for (const term of getNodesByType('terminal')) {
          if (terminalHasProject(term.id)) continue;
          const td = getTerminalData(term.id);
          if (td?.connectedProjectPath === selected) {
            const conn = addConnection(term.id, handle.id);
            if (conn) setTerminalProjectLabel(term.id, projectName);
          }
        }
      }
      return;
    }

    // Cmd+Shift+B — new disconnected browser (check BEFORE Cmd+B)
    if (e.metaKey && e.shiftKey && e.code === 'KeyB') {
      e.preventDefault();
      const viewX = (-world.x + window.innerWidth / 2) / world.scale.x - BROWSER_WIDTH / 2;
      const viewY = (-world.y + window.innerHeight / 2) / world.scale.y - BROWSER_HEIGHT / 2;
      const handle = createNode(world, viewX, viewY);
      await createBrowserNode(handle.id, handle.gfx, BROWSER_WIDTH, BROWSER_HEIGHT);
      attachNodule(handle.id);
      attachResizeFrame(handle.id);
      setActiveBrowserNode(handle.id);
      focusUrlInput(handle.id);
      return;
    }

    // Cmd+B — new browser node paired with a terminal (only one allowed)
    if (e.metaKey && !e.shiftKey && e.code === 'KeyB') {
      e.preventDefault();

      // If any browser exists, focus it
      const existingBrowsers = getNodesByType('browser');
      if (existingBrowsers.length > 0) {
        setActiveBrowserNode(existingBrowsers[0].id);
        focusUrlInput(existingBrowsers[0].id);
        return;
      }

      // Find a terminal that doesn't already have a browser
      const target = findTerminalWithoutBrowser();
      const termId = target?.termId ?? null;
      const termNode = target?.node ?? null;

      // Find a dev server URL from the target terminal or any terminal
      let detectedUrl = termId ? (getTerminalDetectedUrl(termId) || '') : '';
      if (!detectedUrl) {
        for (const t of getNodesByType('terminal')) {
          const url = getTerminalDetectedUrl(t.id);
          if (url) { detectedUrl = url; break; }
        }
      }

      // No dev server running — try to auto-start one
      if (!detectedUrl && termId) {
        const devCmd = await detectDevCommand(termId);
        if (devCmd) {
          invoke('write_pty', { id: termId, data: devCmd + '\n' }).catch(() => {});
        }
      }

      if (termNode && termId) {
        // Position to the right of the terminal
        const browserX = termNode.gfx.x + termNode.width + 50;
        const browserY = termNode.gfx.y;
        const handle = createNode(world, browserX, browserY);
        await createBrowserNode(handle.id, handle.gfx, BROWSER_WIDTH, BROWSER_HEIGHT, detectedUrl, termId);
        attachNodule(handle.id);
        attachResizeFrame(handle.id);
        addConnection(handle.id, termId);
        setActiveBrowserNode(handle.id);
      } else {
        // No available terminal — position right of project or viewport center
        const projects = getNodesByType('project');
        let viewX: number, viewY: number;
        if (projects.length > 0) {
          const p = projects[0];
          viewX = p.gfx.x + p.width + NODE_WIDTH + 100;
          viewY = p.gfx.y;
        } else {
          viewX = (-world.x + window.innerWidth / 2) / world.scale.x - BROWSER_WIDTH / 2;
          viewY = (-world.y + window.innerHeight / 2) / world.scale.y - BROWSER_HEIGHT / 2;
        }
        const handle = createNode(world, viewX, viewY);
        await createBrowserNode(handle.id, handle.gfx, BROWSER_WIDTH, BROWSER_HEIGHT, detectedUrl);
        attachNodule(handle.id);
        attachResizeFrame(handle.id);
        setActiveBrowserNode(handle.id);
        if (!detectedUrl) focusUrlInput(handle.id);
      }
      return;
    }
  });

  // Open file viewer on double-click from project tree
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
    await createViewerNode(handle.id, handle.gfx, VIEWER_WIDTH, VIEWER_HEIGHT, filePath, fileName);
    attachNodule(handle.id);
    attachResizeFrame(handle.id);
    blurAllTerminals();
    setActiveViewerNode(handle.id);

    if (projectNode) {
      addConnection(handle.id, projectNode.id);
    }
  });
}

/**
 * Detect the dev server command for a terminal by inspecting its connected project.
 * Checks package.json for common dev scripts (dev, start, serve).
 */
async function detectDevCommand(termId: string): Promise<string | null> {
  // Find a project connected to this terminal
  const conns = getConnectionsForNode(termId);
  let projectPath: string | null = null;
  for (const conn of conns) {
    const otherId = conn.sourceId === termId ? conn.targetId : conn.sourceId;
    const other = getNode(otherId);
    if (other?.type === 'project') {
      projectPath = getProjectPath(otherId) || null;
      break;
    }
  }
  if (!projectPath) {
    // No connected project — check if there's only one project node
    const projects = getNodesByType('project');
    if (projects.length === 1) {
      projectPath = getProjectPath(projects[0].id) || null;
    }
  }
  if (!projectPath) return null;

  // Check for package.json
  try {
    const raw = await invoke<string>('read_file_contents', { path: `${projectPath}/package.json` });
    const pkg = JSON.parse(raw);
    const scripts = pkg.scripts || {};
    if (scripts.dev) return 'npm run dev';
    if (scripts.start) return 'npm run start';
    if (scripts.serve) return 'npm run serve';
  } catch { /* no package.json or invalid */ }

  return null;
}

/**
 * Auto-connect a newly created terminal to an existing unconnected browser.
 * Repositions the browser to the right of the terminal and kicks off dev server.
 */
async function autoConnectBrowser(termId: string): Promise<void> {
  // Skip if this terminal already has a browser
  if (getBrowserForTerminal(termId)) return;

  const emptyBrowserId = findUnconnectedBrowser();
  if (!emptyBrowserId) return;

  const bd = getBrowserData(emptyBrowserId);
  if (!bd) return;

  const termNode = getNode(termId);
  const browserNode = getNode(emptyBrowserId);

  // Reposition browser to the right of the terminal
  if (termNode && browserNode) {
    browserNode.gfx.x = termNode.gfx.x + termNode.width + 50;
    browserNode.gfx.y = termNode.gfx.y;
  }

  // Wire the connection — validate first
  const conn = addConnection(emptyBrowserId, termId);
  if (!conn) return;
  bd.connectedTerminalId = termId;

  // Try to auto-start dev server
  const devCmd = await detectDevCommand(termId);
  if (devCmd) {
    invoke('write_pty', { id: termId, data: devCmd + '\n' }).catch(() => {});
  }
}

/** Find a browser node that isn't connected to any terminal. */
function findUnconnectedBrowser(): string | null {
  for (const entry of getNodesByType('browser')) {
    const data = getBrowserData(entry.id);
    if (data && !data.connectedTerminalId) return entry.id;
  }
  return null;
}

/** Find the first terminal that doesn't already have a browser connected. */
function findTerminalWithoutBrowser(): { termId: string; node: NodeEntry } | null {
  // Prefer active terminal, then last-active, then any
  const activeId = getActiveNodeId();
  const activeEntry = activeId ? getNode(activeId) : null;
  if (activeEntry?.type === 'terminal' && !getBrowserForTerminal(activeId!)) {
    return { termId: activeId!, node: activeEntry };
  }

  const lastId = getLastActiveTerminalId();
  if (lastId) {
    const lastNode = getNode(lastId);
    if (lastNode && !getBrowserForTerminal(lastId)) {
      return { termId: lastId, node: lastNode };
    }
  }

  for (const entry of getNodesByType('terminal')) {
    if (!getBrowserForTerminal(entry.id)) {
      return { termId: entry.id, node: entry };
    }
  }
  return null;
}

function findTargetProject(): NodeEntry | null {
  const projects = getNodesByType('project');
  if (projects.length === 0) return null;

  // If active node is a project, use it
  const activeId = getActiveNodeId();
  const activeEntry = activeId ? getNode(activeId) : null;
  if (activeEntry?.type === 'project') return activeEntry;

  // Last-active project
  const lastProjId = getLastActiveProjectId();
  if (lastProjId) {
    const lastProj = getNode(lastProjId);
    if (lastProj) return lastProj;
  }

  // If exactly one project, use it
  if (projects.length === 1) return projects[0];

  // Multiple projects, none active — don't guess
  return null;
}

init();
