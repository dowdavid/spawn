// src/state.ts
import type { Graphics, Container } from 'pixi.js';

export type NodeType = 'terminal' | 'project' | 'viewer' | 'browser';

export interface NodeEntry {
  id: string;
  type: NodeType;
  gfx: Graphics;
  overlay: HTMLDivElement;
  width: number;
  height: number;
}

export interface Connection {
  id: string;
  sourceId: string;
  targetId: string;
  element: SVGPathElement | null;
}

const nodes = new Map<string, NodeEntry>();
const connections = new Map<string, Connection>();
let activeNodeId: string | null = null;
let lastActiveTerminalId: string | null = null;
let lastActiveProjectId: string | null = null;
let overlayContainer: HTMLDivElement;

export function initOverlayContainer(): HTMLDivElement {
  overlayContainer = document.createElement('div');
  overlayContainer.style.cssText =
    'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;z-index:10;';
  document.body.appendChild(overlayContainer);
  return overlayContainer;
}

export function getOverlayContainer(): HTMLDivElement {
  return overlayContainer;
}

export function registerNode(entry: NodeEntry) {
  nodes.set(entry.id, entry);
}

export function unregisterNode(id: string) {
  nodes.delete(id);
  for (const [connId, conn] of connections) {
    if (conn.sourceId === id || conn.targetId === id) {
      if (conn.element) conn.element.remove();
      connections.delete(connId);
    }
  }
  if (activeNodeId === id) activeNodeId = null;
}

export function getNode(id: string): NodeEntry | undefined {
  return nodes.get(id);
}

export function getAllNodes(): NodeEntry[] {
  return Array.from(nodes.values());
}

export function getNodesByType(type: NodeType): NodeEntry[] {
  return getAllNodes().filter((n) => n.type === type);
}

export function addConnection(sourceId: string, targetId: string): Connection | null {
  if (!canConnect(sourceId, targetId)) return null;
  const id = crypto.randomUUID();
  return addConnectionWithId(id, sourceId, targetId);
}

export function addConnectionWithId(id: string, sourceId: string, targetId: string): Connection {
  const conn: Connection = { id, sourceId, targetId, element: null };
  connections.set(id, conn);
  return conn;
}

export function removeConnection(id: string) {
  const conn = connections.get(id);
  if (!conn) return;
  if (conn.element) conn.element.remove();
  connections.delete(id);
}

export function getAllConnections(): Connection[] {
  return Array.from(connections.values());
}

export function getConnectionsForNode(nodeId: string): Connection[] {
  return getAllConnections().filter(
    (c) => c.sourceId === nodeId || c.targetId === nodeId,
  );
}

export function setActiveNodeId(id: string | null) {
  activeNodeId = id;
  if (id) {
    const entry = nodes.get(id);
    if (entry?.type === 'terminal') lastActiveTerminalId = id;
    if (entry?.type === 'project') lastActiveProjectId = id;
  }
}

export function getActiveNodeId(): string | null {
  return activeNodeId;
}

export function getLastActiveTerminalId(): string | null {
  if (lastActiveTerminalId && nodes.has(lastActiveTerminalId)) {
    return lastActiveTerminalId;
  }
  return null;
}

export function getLastActiveProjectId(): string | null {
  if (lastActiveProjectId && nodes.has(lastActiveProjectId)) {
    return lastActiveProjectId;
  }
  return null;
}

// --- Connection validation ---

const VALID_PAIRS: Record<NodeType, NodeType[]> = {
  terminal: ['project', 'browser'],
  project:  ['terminal', 'viewer'],
  viewer:   ['project'],
  browser:  ['terminal'],
};

const MAX_CONNECTIONS: Partial<Record<NodeType, Partial<Record<NodeType, number>>>> = {
  terminal: { project: 1, browser: 1 },
  browser:  { terminal: 1 },
  viewer:   { project: 1 },
};

function countConnectionsByType(nodeId: string, peerType: NodeType): number {
  let count = 0;
  for (const conn of connections.values()) {
    if (conn.sourceId !== nodeId && conn.targetId !== nodeId) continue;
    const peerId = conn.sourceId === nodeId ? conn.targetId : conn.sourceId;
    const peer = nodes.get(peerId);
    if (peer?.type === peerType) count++;
  }
  return count;
}

export function canConnect(sourceId: string, targetId: string): boolean {
  const source = nodes.get(sourceId);
  const target = nodes.get(targetId);
  if (!source || !target) return false;

  // Valid type pair (check both directions)
  if (!VALID_PAIRS[source.type].includes(target.type)) return false;

  // No duplicate connections
  for (const conn of connections.values()) {
    if (
      (conn.sourceId === sourceId && conn.targetId === targetId) ||
      (conn.sourceId === targetId && conn.targetId === sourceId)
    ) return false;
  }

  // Slot limits
  const sourceLimit = MAX_CONNECTIONS[source.type]?.[target.type];
  if (sourceLimit !== undefined && countConnectionsByType(sourceId, target.type) >= sourceLimit) return false;

  const targetLimit = MAX_CONNECTIONS[target.type]?.[source.type];
  if (targetLimit !== undefined && countConnectionsByType(targetId, source.type) >= targetLimit) return false;

  return true;
}

export function hasAvailableSlot(nodeId: string): boolean {
  const entry = nodes.get(nodeId);
  if (!entry) return false;

  const validPeers = VALID_PAIRS[entry.type];
  for (const peerType of validPeers) {
    const limit = MAX_CONNECTIONS[entry.type]?.[peerType];
    // No limit (e.g. project→terminal) means always open
    if (limit === undefined) return true;
    if (countConnectionsByType(nodeId, peerType) < limit) return true;
  }
  return false;
}

export function terminalHasProject(terminalId: string): boolean {
  return countConnectionsByType(terminalId, 'project') > 0;
}

export function terminalHasBrowser(terminalId: string): boolean {
  return countConnectionsByType(terminalId, 'browser') > 0;
}
