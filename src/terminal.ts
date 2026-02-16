import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Container, Graphics } from 'pixi.js';
import { NODE_WIDTH, NODE_HEIGHT, TITLE_BAR_HEIGHT } from './node';
import {
  getOverlayContainer,
  registerNode,
  unregisterNode,
  getNode,
  getAllNodes,
  setActiveNodeId,
  getActiveNodeId,
} from './state';

export interface TerminalNodeData {
  terminal: Terminal;
  fitAddon: FitAddon;
  unlisten: UnlistenFn;
}

const BORDER_WIDTH = 2;
const CORNER_RADIUS = 8;

const BORDER_DEFAULT = '#0f3460';
const BORDER_FOCUSED = '#e94560';
const FILL_COLOR = '#16213e';
const TITLE_BAR_COLOR = '#0f2040';

const terminalData = new Map<string, TerminalNodeData>();

export async function createTerminalNode(
  id: string,
  gfx: Graphics,
  nodeWidth: number,
  nodeHeight: number,
  cwd?: string,
  connectedProjectPath?: string,
): Promise<void> {
  const overlayContainer = getOverlayContainer();

  // Outer wrapper — covers the full node area including border
  const overlay = document.createElement('div');
  overlay.className = 'terminal-overlay';
  overlay.style.cssText = `
    position:absolute;
    pointer-events:auto;
    overflow:hidden;
    background:${FILL_COLOR};
    border:${BORDER_WIDTH}px solid ${BORDER_DEFAULT};
    border-radius:${CORNER_RADIUS}px;
    box-sizing:border-box;
  `;
  overlayContainer.appendChild(overlay);

  // Title bar div
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
  `;
  // Drag grip icon (left)
  const gripIcon = document.createElement('div');
  gripIcon.style.cssText = 'display:flex;align-items:center;';
  gripIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4a5568" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>`;
  titleBar.appendChild(gripIcon);

  // Title label (shows project path if connected)
  if (connectedProjectPath) {
    const titleLabel = document.createElement('div');
    const shortPath = connectedProjectPath.replace(/^\/Users\/[^/]+/, '~');
    titleLabel.style.cssText = 'color:#6a7a8a;font-family:Menlo,Monaco,monospace;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    titleLabel.textContent = shortPath;
    titleBar.appendChild(titleLabel);
  }

  // Spacer
  const spacer = document.createElement('div');
  spacer.style.cssText = 'flex:1;';
  titleBar.appendChild(spacer);

  // Close button (right)
  const closeBtn = document.createElement('div');
  closeBtn.style.cssText = 'display:flex;align-items:center;cursor:pointer;padding:2px;border-radius:4px;';
  closeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4a5568" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
  closeBtn.addEventListener('mouseenter', () => { closeBtn.querySelector('svg')!.style.stroke = '#e94560'; });
  closeBtn.addEventListener('mouseleave', () => { closeBtn.querySelector('svg')!.style.stroke = '#4a5568'; });
  closeBtn.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    destroyTerminalNode(id);
    const parent = gfx.parent;
    if (parent) parent.removeChild(gfx);
  });
  titleBar.appendChild(closeBtn);

  overlay.appendChild(titleBar);

  // Terminal wrapper with padding
  const termPadding = document.createElement('div');
  termPadding.style.cssText = `
    width:100%;
    height:calc(100% - ${TITLE_BAR_HEIGHT}px);
    overflow:hidden;
    padding:6px 0px 12px 12px;
    box-sizing:border-box;
  `;
  overlay.appendChild(termPadding);

  // Inner container that xterm.js fits into
  const termContainer = document.createElement('div');
  termContainer.style.cssText = `
    width:100%;
    height:100%;
    overflow:hidden;
  `;
  termPadding.appendChild(termContainer);

  const terminal = new Terminal({
    theme: {
      background: FILL_COLOR,
      foreground: '#e0e0e0',
      cursor: '#e94560',
      selectionBackground: '#0f346080',
    },
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    fontSize: 14,
    allowProposedApi: true,
    cursorBlink: true,
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(termContainer);

  // Size the overlay so fitAddon can calculate cols/rows
  overlay.style.width = `${nodeWidth}px`;
  overlay.style.height = `${nodeHeight}px`;
  fitAddon.fit();

  const cols = terminal.cols;
  const rows = terminal.rows;

  // Spawn PTY backend
  await invoke('spawn_pty', { id, cols, rows, cwd: cwd ?? null });

  // Listen for PTY output
  const unlisten = await listen<string>(`pty-output-${id}`, (event) => {
    terminal.write(event.payload);
  });

  // Send input to PTY
  terminal.onData((data: string) => {
    invoke('write_pty', { id, data });
  });

  // Title bar drag — delegates to PixiJS gfx for world-space dragging
  let dragging = false;
  let dragStartWorldX = 0;
  let dragStartWorldY = 0;
  let gfxStartX = 0;
  let gfxStartY = 0;

  titleBar.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    // Bring to front
    const parent = gfx.parent;
    if (parent) {
      parent.setChildIndex(gfx, parent.children.length - 1);
    }
    setActiveNode(id);

    dragging = true;
    titleBar.style.cursor = 'grabbing';
    dragStartWorldX = e.clientX;
    dragStartWorldY = e.clientY;
    gfxStartX = gfx.x;
    gfxStartY = gfx.y;
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

  // Click terminal area to focus
  termContainer.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    const parent = gfx.parent;
    if (parent) {
      parent.setChildIndex(gfx, parent.children.length - 1);
    }
    setActiveNode(id);
  });

  // Register in centralized state
  registerNode({
    id,
    type: 'terminal',
    gfx,
    overlay,
    width: nodeWidth,
    height: nodeHeight,
  });

  // Store terminal-specific data locally
  terminalData.set(id, { terminal, fitAddon, unlisten });
}

export function setActiveNode(id: string | null) {
  setActiveNodeId(id);
  for (const [nodeId, data] of terminalData) {
    const entry = getNode(nodeId);
    if (!entry) continue;
    if (nodeId === id) {
      data.terminal.focus();
      entry.overlay.style.borderColor = BORDER_FOCUSED;
      entry.overlay.style.zIndex = `${getAllNodes().length + 1}`;
    } else {
      data.terminal.blur();
      entry.overlay.style.borderColor = BORDER_DEFAULT;
    }
  }
}

export function blurAllTerminals() {
  for (const [id, data] of terminalData) {
    data.terminal.blur();
    const entry = getNode(id);
    if (entry) entry.overlay.style.borderColor = BORDER_DEFAULT;
  }
}

export function syncOverlays(world: Container) {
  const scale = world.scale.x;
  const worldX = world.x;
  const worldY = world.y;

  const activeId = getActiveNodeId();

  for (const entry of getAllNodes()) {
    entry.overlay.style.display = 'block';

    // Position at the gfx origin — overlay covers the full node
    const x = entry.gfx.x * scale + worldX;
    const y = entry.gfx.y * scale + worldY;

    // z-index matches PixiJS child order
    const childIndex = world.children.indexOf(entry.gfx);
    if (entry.id !== activeId) {
      entry.overlay.style.zIndex = `${childIndex}`;
    }

    entry.overlay.style.left = `${x}px`;
    entry.overlay.style.top = `${y}px`;
    entry.overlay.style.width = `${entry.width}px`;
    entry.overlay.style.height = `${entry.height}px`;
    entry.overlay.style.transformOrigin = 'top left';
    entry.overlay.style.transform = `scale(${scale})`;
  }
}

export async function destroyTerminalNode(id: string) {
  const data = terminalData.get(id);
  if (!data) return;
  data.unlisten();
  data.terminal.dispose();
  const entry = getNode(id);
  if (entry) entry.overlay.remove();
  await invoke('kill_pty', { id });
  terminalData.delete(id);
  unregisterNode(id);
}
