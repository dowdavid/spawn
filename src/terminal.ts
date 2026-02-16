import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Container, Graphics } from 'pixi.js';

export interface TerminalNode {
  id: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  overlay: HTMLDivElement;
  unlisten: UnlistenFn;
  gfx: Graphics;
}

const BORDER_INSET = 4;
const MIN_VISIBLE_SCALE = 0.3;
const FILL_COLOR = '#16213e';
const BORDER_DEFAULT = '#0f3460';
const BORDER_FOCUSED = '#e94560';

const nodes: TerminalNode[] = [];
let overlayContainer: HTMLDivElement;
let activeNodeId: string | null = null;

export function initOverlayContainer(): HTMLDivElement {
  overlayContainer = document.createElement('div');
  overlayContainer.style.cssText =
    'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;z-index:10;';
  document.body.appendChild(overlayContainer);
  return overlayContainer;
}

export async function createTerminalNode(
  id: string,
  gfx: Graphics,
  nodeWidth: number,
  nodeHeight: number,
): Promise<TerminalNode> {
  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:absolute;pointer-events:auto;overflow:hidden;';
  overlayContainer.appendChild(overlay);

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
  terminal.open(overlay);

  // Size the overlay so fitAddon can calculate cols/rows
  overlay.style.width = `${nodeWidth - BORDER_INSET * 2}px`;
  overlay.style.height = `${nodeHeight - BORDER_INSET * 2}px`;
  fitAddon.fit();

  const cols = terminal.cols;
  const rows = terminal.rows;

  // Spawn PTY backend
  await invoke('spawn_pty', { id, cols, rows });

  // Listen for PTY output
  const unlisten = await listen<string>(`pty-output-${id}`, (event) => {
    terminal.write(event.payload);
  });

  // Send input to PTY
  terminal.onData((data: string) => {
    invoke('write_pty', { id, data });
  });

  // Focus handling
  overlay.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    setActiveNode(id);
  });

  const node: TerminalNode = { id, terminal, fitAddon, overlay, unlisten, gfx };
  nodes.push(node);
  return node;
}

function redrawBorder(gfx: Graphics, color: string) {
  const w = gfx.width;
  const h = gfx.height;
  gfx.clear()
    .roundRect(0, 0, w, h, 8)
    .fill(FILL_COLOR)
    .stroke({ width: 2, color });
}

export function setActiveNode(id: string | null) {
  activeNodeId = id;
  for (const node of nodes) {
    if (node.id === id) {
      node.terminal.focus();
      redrawBorder(node.gfx, BORDER_FOCUSED);
    } else {
      node.terminal.blur();
      redrawBorder(node.gfx, BORDER_DEFAULT);
    }
  }
}

export function blurAllTerminals() {
  setActiveNode(null);
}

export function syncOverlays(world: Container) {
  const scale = world.scale.x;
  const worldX = world.x;
  const worldY = world.y;

  for (const node of nodes) {
    if (scale < MIN_VISIBLE_SCALE) {
      node.overlay.style.display = 'none';
      continue;
    }

    node.overlay.style.display = 'block';

    const x = node.gfx.x * scale + worldX + BORDER_INSET * scale;
    const y = node.gfx.y * scale + worldY + BORDER_INSET * scale;

    node.overlay.style.left = `${x}px`;
    node.overlay.style.top = `${y}px`;
    node.overlay.style.width = `${node.gfx.width - BORDER_INSET * 2}px`;
    node.overlay.style.height = `${node.gfx.height - BORDER_INSET * 2}px`;
    node.overlay.style.transformOrigin = 'top left';
    node.overlay.style.transform = `scale(${scale})`;
  }
}

export async function destroyTerminalNode(id: string) {
  const idx = nodes.findIndex((n) => n.id === id);
  if (idx === -1) return;
  const node = nodes[idx];
  node.unlisten();
  node.terminal.dispose();
  node.overlay.remove();
  await invoke('kill_pty', { id });
  nodes.splice(idx, 1);
  if (activeNodeId === id) activeNodeId = null;
}
