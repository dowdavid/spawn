// src/nodule.ts — connection nodules for disconnected nodes
import { getAllNodes, getNode, getConnectionsForNode, getOverlayContainer, addConnection, type NodeType } from './state';
import { createConnectionPath } from './connection';
import { getProjectPath } from './project';
import { setTerminalProjectLabel } from './terminal';

const nodules = new Map<string, HTMLDivElement>();

// Accent color per node type (matches focused border colors)
const NODULE_COLORS: Record<NodeType, string> = {
  terminal: '#e94560',
  project: '#a78bfa',
  viewer: '#34d399',
};

// Valid connection pairs: source type → allowed target types
const VALID_TARGETS: Record<NodeType, NodeType[]> = {
  terminal: ['project'],
  project: ['terminal'],
  viewer: ['project'],
};

const NODULE_SIZE = 12;

// Drag state
let dragging = false;
let dragSourceId: string | null = null;
let tempPath: SVGPathElement | null = null;
let highlightedOverlay: HTMLDivElement | null = null;

export function attachNodule(nodeId: string) {
  if (nodules.has(nodeId)) return;

  const entry = getNode(nodeId);
  if (!entry) return;

  const color = NODULE_COLORS[entry.type];

  const el = document.createElement('div');
  el.style.cssText = `
    position: fixed;
    width: ${NODULE_SIZE}px;
    height: ${NODULE_SIZE}px;
    border-radius: 50%;
    background: ${color};
    cursor: crosshair;
    z-index: 20;
    pointer-events: auto;
    box-shadow: 0 0 6px ${color}88;
    animation: nodule-pulse-${entry.type} 2s ease-in-out infinite;
  `;

  // Inject keyframes once per type
  const styleId = `nodule-style-${entry.type}`;
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes nodule-pulse-${entry.type} {
        0%, 100% { box-shadow: 0 0 6px ${color}88; }
        50% { box-shadow: 0 0 12px ${color}cc; }
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

  const color = NODULE_COLORS[sourceEntry.type];
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
        connectNodes(dragSourceId, targetId);
      }
    }

    dragging = false;
    dragSourceId = null;
  };

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function hitTestNode(x: number, y: number, sourceId: string): string | null {
  const sourceEntry = getNode(sourceId);
  if (!sourceEntry) return null;

  const allowed = VALID_TARGETS[sourceEntry.type];

  for (const entry of getAllNodes()) {
    if (entry.id === sourceId) continue;
    if (!allowed.includes(entry.type)) continue;
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
      const color = NODULE_COLORS[sourceEntry.type];
      entry.overlay.style.boxShadow = `0 0 15px ${color}88`;
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

function connectNodes(sourceId: string, targetId: string) {
  addConnection(sourceId, targetId);

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
    el.style.top = `${rect.top + rect.height / 2 - NODULE_SIZE / 2}px`;
  }
}
