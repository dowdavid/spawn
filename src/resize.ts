// src/resize.ts — resizable node handles embedded directly in overlays
// Cursor affordance via Tauri native setCursorIcon (reliable on macOS WKWebView)
import { getNode, getAllNodes, type NodeType } from './state';
import {
  NODE_WIDTH, NODE_HEIGHT,
  PROJECT_WIDTH, PROJECT_HEIGHT,
  VIEWER_WIDTH, VIEWER_HEIGHT,
  MIN_NODE_WIDTH, MIN_NODE_HEIGHT,
  MIN_PROJECT_WIDTH, MIN_PROJECT_HEIGHT,
  MIN_VIEWER_WIDTH, MIN_VIEWER_HEIGHT,
} from './node';
import { refitTerminal } from './terminal';
import { getCurrentWindow, type CursorIcon } from '@tauri-apps/api/window';

const EDGE_ZONE = 8;
const CORNER_ZONE = 14;
const REFIT_THROTTLE = 100;

const DEFAULT_SIZES: Record<NodeType, { w: number; h: number }> = {
  terminal: { w: NODE_WIDTH, h: NODE_HEIGHT },
  project: { w: PROJECT_WIDTH, h: PROJECT_HEIGHT },
  viewer: { w: VIEWER_WIDTH, h: VIEWER_HEIGHT },
};

const MIN_SIZES: Record<NodeType, { w: number; h: number }> = {
  terminal: { w: MIN_NODE_WIDTH, h: MIN_NODE_HEIGHT },
  project: { w: MIN_PROJECT_WIDTH, h: MIN_PROJECT_HEIGHT },
  viewer: { w: MIN_VIEWER_WIDTH, h: MIN_VIEWER_HEIGHT },
};

type Zone = 'top' | 'bottom' | 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

const ZONE_TAURI_CURSORS: Record<Zone, CursorIcon> = {
  top: 'nsResize',
  bottom: 'nsResize',
  left: 'ewResize',
  right: 'ewResize',
  'top-left': 'nwseResize',
  'top-right': 'neswResize',
  'bottom-left': 'neswResize',
  'bottom-right': 'nwseResize',
};

// Maps nodeId → array of handle elements attached to the overlay
const handleElements = new Map<string, HTMLDivElement[]>();

// --- Cursor state ---
let currentZone: Zone | null = null;
let cursorOverrideActive = false;
const appWindow = getCurrentWindow();

// --- Drag state ---
let resizing = false;
let resizeNodeId: string | null = null;
let resizeZone: Zone | null = null;
let startMouseX = 0;
let startMouseY = 0;
let startWidth = 0;
let startHeight = 0;
let startGfxX = 0;
let startGfxY = 0;
let dragScale = 1;
let lastRefitTime = 0;

// --- Cursor detection ---

function detectZoneAtPoint(x: number, y: number): { nodeId: string; zone: Zone } | null {
  const nodes = getAllNodes();
  let best: { nodeId: string; zone: Zone; zIndex: number } | null = null;

  for (const entry of nodes) {
    const rect = entry.overlay.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    if (x < rect.left - 2 || x > rect.right + 2 || y < rect.top - 2 || y > rect.bottom + 2) continue;

    const nearLeft = x < rect.left + EDGE_ZONE;
    const nearRight = x > rect.right - EDGE_ZONE;
    const nearTop = y < rect.top + EDGE_ZONE;
    const nearBottom = y > rect.bottom - EDGE_ZONE;

    let zone: Zone | null = null;
    if (nearTop && nearLeft) zone = 'top-left';
    else if (nearTop && nearRight) zone = 'top-right';
    else if (nearBottom && nearLeft) zone = 'bottom-left';
    else if (nearBottom && nearRight) zone = 'bottom-right';
    else if (nearLeft) zone = 'left';
    else if (nearRight) zone = 'right';
    else if (nearTop) zone = 'top';
    else if (nearBottom) zone = 'bottom';

    if (!zone) continue;

    const z = parseInt(entry.overlay.style.zIndex || '0', 10);
    if (!best || z > best.zIndex) {
      best = { nodeId: entry.id, zone, zIndex: z };
    }
  }

  return best;
}

function setNativeCursor(zone: Zone | null): void {
  if (zone === currentZone) return;
  currentZone = zone;

  if (zone) {
    cursorOverrideActive = true;
    appWindow.setCursorIcon(ZONE_TAURI_CURSORS[zone]).catch(() => {});
  } else if (cursorOverrideActive) {
    cursorOverrideActive = false;
    appWindow.setCursorIcon('default').catch(() => {});
  }
}

function onGlobalMouseMove(e: MouseEvent): void {
  if (resizing) return;
  const hit = detectZoneAtPoint(e.clientX, e.clientY);
  setNativeCursor(hit ? hit.zone : null);
}

/** Call once during app init to enable resize cursor affordance. */
export function initResizeCursors(): void {
  window.addEventListener('mousemove', onGlobalMouseMove);
}

// --- Handle elements (for mousedown hit targets inside overlays) ---

function createHandle(zone: Zone): HTMLDivElement {
  const el = document.createElement('div');
  el.dataset.zone = zone;
  el.style.position = 'absolute';
  el.style.zIndex = '100';
  el.style.pointerEvents = 'auto';

  const isCorner = zone.includes('-');

  if (isCorner) {
    el.style.width = `${CORNER_ZONE}px`;
    el.style.height = `${CORNER_ZONE}px`;
  }

  switch (zone) {
    case 'top':
      el.style.top = '0';
      el.style.left = `${CORNER_ZONE}px`;
      el.style.right = `${CORNER_ZONE}px`;
      el.style.height = `${EDGE_ZONE}px`;
      break;
    case 'bottom':
      el.style.bottom = '0';
      el.style.left = `${CORNER_ZONE}px`;
      el.style.right = `${CORNER_ZONE}px`;
      el.style.height = `${EDGE_ZONE}px`;
      break;
    case 'left':
      el.style.left = '0';
      el.style.top = `${CORNER_ZONE}px`;
      el.style.bottom = `${CORNER_ZONE}px`;
      el.style.width = `${EDGE_ZONE}px`;
      break;
    case 'right':
      el.style.right = '0';
      el.style.top = `${CORNER_ZONE}px`;
      el.style.bottom = `${CORNER_ZONE}px`;
      el.style.width = `${EDGE_ZONE}px`;
      break;
    case 'top-left':
      el.style.top = '0';
      el.style.left = '0';
      break;
    case 'top-right':
      el.style.top = '0';
      el.style.right = '0';
      break;
    case 'bottom-left':
      el.style.bottom = '0';
      el.style.left = '0';
      break;
    case 'bottom-right':
      el.style.bottom = '0';
      el.style.right = '0';
      break;
  }

  return el;
}

export function attachResizeFrame(nodeId: string): void {
  if (handleElements.has(nodeId)) return;

  const entry = getNode(nodeId);
  if (!entry) return;

  const zones: Zone[] = ['top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
  const nodeHandles: HTMLDivElement[] = [];

  for (const zone of zones) {
    const handle = createHandle(zone);
    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      startResize(nodeId, zone, e);
    });
    entry.overlay.appendChild(handle);
    nodeHandles.push(handle);
  }

  handleElements.set(nodeId, nodeHandles);
}

export function detachResizeFrame(nodeId: string): void {
  const nodeHandles = handleElements.get(nodeId);
  if (nodeHandles) {
    for (const h of nodeHandles) h.remove();
    handleElements.delete(nodeId);
  }
  if (resizeNodeId === nodeId) {
    resizing = false;
    resizeNodeId = null;
    resizeZone = null;
    setNativeCursor(null);
    window.removeEventListener('mousemove', onResizeMove);
    window.removeEventListener('mouseup', onResizeEnd);
  }
}

// --- Resize drag logic ---

function startResize(nodeId: string, zone: Zone, e: MouseEvent): void {
  const entry = getNode(nodeId);
  if (!entry) return;

  resizing = true;
  resizeNodeId = nodeId;
  resizeZone = zone;
  startMouseX = e.clientX;
  startMouseY = e.clientY;
  startWidth = entry.width;
  startHeight = entry.height;
  startGfxX = entry.gfx.x;
  startGfxY = entry.gfx.y;
  dragScale = entry.gfx.parent?.scale.x ?? 1;
  lastRefitTime = 0;

  setNativeCursor(zone);

  window.addEventListener('mousemove', onResizeMove);
  window.addEventListener('mouseup', onResizeEnd);
}

function onResizeMove(e: MouseEvent): void {
  if (!resizing || !resizeNodeId || !resizeZone) return;

  const entry = getNode(resizeNodeId);
  if (!entry) return;

  const dx = (e.clientX - startMouseX) / dragScale;
  const dy = (e.clientY - startMouseY) / dragScale;
  const min = MIN_SIZES[entry.type];

  let newWidth = startWidth;
  let newHeight = startHeight;
  let newGfxX = startGfxX;
  let newGfxY = startGfxY;

  if (resizeZone.includes('right')) {
    newWidth = Math.max(min.w, startWidth + dx);
  } else if (resizeZone.includes('left')) {
    const proposedWidth = startWidth - dx;
    if (proposedWidth >= min.w) {
      newWidth = proposedWidth;
      newGfxX = startGfxX + dx;
    } else {
      newWidth = min.w;
      newGfxX = startGfxX + (startWidth - min.w);
    }
  }

  if (resizeZone.includes('bottom')) {
    newHeight = Math.max(min.h, startHeight + dy);
  } else if (resizeZone.includes('top')) {
    const proposedHeight = startHeight - dy;
    if (proposedHeight >= min.h) {
      newHeight = proposedHeight;
      newGfxY = startGfxY + dy;
    } else {
      newHeight = min.h;
      newGfxY = startGfxY + (startHeight - min.h);
    }
  }

  entry.width = newWidth;
  entry.height = newHeight;
  entry.gfx.x = newGfxX;
  entry.gfx.y = newGfxY;

  if (entry.type === 'terminal') {
    const now = Date.now();
    if (now - lastRefitTime >= REFIT_THROTTLE) {
      lastRefitTime = now;
      refitTerminal(entry.id);
    }
  }
}

function onResizeEnd(): void {
  if (resizing && resizeNodeId) {
    const entry = getNode(resizeNodeId);
    if (entry?.type === 'terminal') {
      refitTerminal(resizeNodeId);
    }
  }

  resizing = false;
  resizeNodeId = null;
  resizeZone = null;
  setNativeCursor(null);
  window.removeEventListener('mousemove', onResizeMove);
  window.removeEventListener('mouseup', onResizeEnd);
}

export function resetNodeSize(nodeId: string): void {
  const entry = getNode(nodeId);
  if (!entry) return;

  const defaults = DEFAULT_SIZES[entry.type];
  entry.width = defaults.w;
  entry.height = defaults.h;

  if (entry.type === 'terminal') {
    refitTerminal(nodeId);
  }
}
