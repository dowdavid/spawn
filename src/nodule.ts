// src/nodule.ts — connection nodules for disconnected nodes
import { getAllNodes, getNode, getConnectionsForNode, getOverlayContainer, addConnection, canConnect, hasAvailableSlot } from './state';
import { createConnectionPath } from './connection';
import { getProjectPath } from './project';
import { setTerminalProjectLabel } from './terminal';
import { accent, noduleSize, noduleGlow, noduleGlowPulse, highlightGlow } from './theme';

const nodules = new Map<string, HTMLDivElement>();

// Drag state
let dragging = false;
let dragSourceId: string | null = null;
let tempPath: SVGPathElement | null = null;
let highlightedOverlay: HTMLDivElement | null = null;

export function attachNodule(nodeId: string) {
  if (nodules.has(nodeId)) return;

  const entry = getNode(nodeId);
  if (!entry) return;

  const color = accent[entry.type];

  const el = document.createElement('div');
  el.style.cssText = `
    position: fixed;
    width: ${noduleSize}px;
    height: ${noduleSize}px;
    border-radius: 50%;
    background: ${color};
    cursor: crosshair;
    z-index: 0;
    pointer-events: auto;
    box-shadow: ${noduleGlow(color)};
    animation: nodule-pulse-${entry.type} 2s ease-in-out infinite;
  `;

  // Inject keyframes once per type
  const styleId = `nodule-style-${entry.type}`;
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes nodule-pulse-${entry.type} {
        0%, 100% { box-shadow: ${noduleGlow(color)}; }
        50% { box-shadow: ${noduleGlowPulse(color)}; }
      }
    `;
    document.head.appendChild(style);
  }

  el.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    startDrag(nodeId);
  });

  // Append to overlay container (not the node overlay, which has overflow:hidden)
  getOverlayContainer().appendChild(el);
  nodules.set(nodeId, el);
}

function startDrag(sourceId: string) {
  const sourceEntry = getNode(sourceId);
  if (!sourceEntry) return;

  dragging = true;
  dragSourceId = sourceId;

  const color = accent[sourceEntry.type];
  tempPath = createConnectionPath();
  tempPath.setAttribute('stroke', color);
  tempPath.setAttribute('stroke-dasharray', '6 4');
  tempPath.setAttribute('stroke-opacity', '0.8');

  const onMove = (e: MouseEvent) => {
    if (!dragging || !tempPath || !dragSourceId) return;

    const nodule = nodules.get(dragSourceId);
    if (!nodule) return;

    // Get nodule center in screen coords
    const rect = nodule.getBoundingClientRect();
    const sx = rect.left + rect.width / 2;
    const sy = rect.top + rect.height / 2;
    const ex = e.clientX;
    const ey = e.clientY;

    // Bezier control points
    const dx = ex - sx;
    const dist = Math.sqrt(dx * dx + (ey - sy) * (ey - sy));
    const curvature = Math.min(dist * 0.3, 80);
    const cx1 = sx + (dx > 0 ? curvature : -curvature);
    const cy1 = sy;
    const cx2 = ex - (dx > 0 ? curvature : -curvature);
    const cy2 = ey;

    tempPath.setAttribute('d', `M ${sx} ${sy} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${ex} ${ey}`);

    // Highlight valid target under cursor
    updateHighlight(e.clientX, e.clientY, dragSourceId);
  };

  const onUp = (e: MouseEvent) => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);

    if (tempPath) {
      tempPath.remove();
      tempPath = null;
    }
    clearHighlight();

    if (dragging && dragSourceId) {
      const targetId = hitTestNode(e.clientX, e.clientY, dragSourceId);
      if (targetId) {
        connectNodes(dragSourceId, targetId).catch(console.warn);
      }
    }

    dragging = false;
    dragSourceId = null;
  };

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function hitTestNode(x: number, y: number, sourceId: string): string | null {
  for (const entry of getAllNodes()) {
    if (entry.id === sourceId) continue;
    if (!canConnect(sourceId, entry.id)) continue;
    const rect = entry.overlay.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      return entry.id;
    }
  }
  return null;
}

function updateHighlight(x: number, y: number, sourceId: string) {
  const targetId = hitTestNode(x, y, sourceId);

  if (highlightedOverlay) {
    highlightedOverlay.style.boxShadow = '';
    highlightedOverlay = null;
  }

  if (targetId) {
    const sourceEntry = getNode(sourceId);
    const entry = getNode(targetId);
    if (entry && sourceEntry) {
      const color = accent[sourceEntry.type];
      entry.overlay.style.boxShadow = highlightGlow(color);
      highlightedOverlay = entry.overlay;
    }
  }
}

function clearHighlight() {
  if (highlightedOverlay) {
    highlightedOverlay.style.boxShadow = '';
    highlightedOverlay = null;
  }
}

async function connectNodes(sourceId: string, targetId: string) {
  const conn = addConnection(sourceId, targetId);
  if (!conn) return;

  const source = getNode(sourceId);
  const target = getNode(targetId);
  if (!source || !target) return;

  // If terminal ↔ project, update terminal label
  if (source.type === 'terminal' && target.type === 'project') {
    const projPath = getProjectPath(target.id);
    if (projPath) {
      const name = projPath.split('/').pop() || projPath;
      setTerminalProjectLabel(sourceId, name);
    }
  } else if (source.type === 'project' && target.type === 'terminal') {
    const projPath = getProjectPath(source.id);
    if (projPath) {
      const name = projPath.split('/').pop() || projPath;
      setTerminalProjectLabel(targetId, name);
    }
  }

  // If browser ↔ terminal, update browser's connectedTerminalId and auto-wire dev server
  if (source.type === 'browser' && target.type === 'terminal') {
    await wireBrowserTerminal(sourceId, targetId);
  } else if (source.type === 'terminal' && target.type === 'browser') {
    await wireBrowserTerminal(targetId, sourceId);
  }
}

async function wireBrowserTerminal(browserId: string, terminalId: string) {
  const { getBrowserData, setBrowserUrl } = await import('./browser');
  const { getTerminalDetectedUrl } = await import('./terminal');
  const { invoke } = await import('@tauri-apps/api/core');

  const bd = getBrowserData(browserId);
  if (bd) bd.connectedTerminalId = terminalId;

  // If the terminal already has a detected URL, push it to the browser
  const detectedUrl = getTerminalDetectedUrl(terminalId);
  if (detectedUrl) {
    if (bd && !bd.url) setBrowserUrl(browserId, detectedUrl);
    return;
  }

  // No URL yet — try to auto-start a dev server
  // Find a project connected to this terminal
  const conns = getConnectionsForNode(terminalId);
  let projectPath: string | null = null;
  for (const conn of conns) {
    const otherId = conn.sourceId === terminalId ? conn.targetId : conn.sourceId;
    const other = getNode(otherId);
    if (other?.type === 'project') {
      projectPath = (await import('./project')).getProjectPath(otherId) || null;
      break;
    }
  }
  if (!projectPath) return;

  try {
    const raw = await invoke<string>('read_file_contents', { path: `${projectPath}/package.json` });
    const pkg = JSON.parse(raw);
    const scripts = pkg.scripts || {};
    const cmd = scripts.dev ? 'npm run dev' : scripts.start ? 'npm run start' : scripts.serve ? 'npm run serve' : null;
    if (cmd) {
      invoke('write_pty', { id: terminalId, data: cmd + '\n' }).catch(() => {});
    }
  } catch { /* no package.json */ }
}

export function syncNoduleVisibility() {
  for (const [nodeId, el] of nodules) {
    const entry = getNode(nodeId);

    const conns = getConnectionsForNode(nodeId);
    if (!entry || conns.length > 0) {
      el.style.display = 'none';
      continue;
    }

    el.style.display = '';

    // Position at the right edge of the overlay, vertically centered, protruding outward
    const rect = entry.overlay.getBoundingClientRect();
    el.style.left = `${rect.right + 2}px`;
    el.style.top = `${rect.top + rect.height / 2 - noduleSize / 2}px`;

    // Match the node's z-index so the nodule doesn't float above other nodes
    el.style.zIndex = entry.overlay.style.zIndex || '0';
  }
}
