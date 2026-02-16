// src/state.ts
import type { Graphics, Container } from 'pixi.js';

export type NodeType = 'terminal' | 'project' | 'viewer';

export interface NodeEntry {
  id: string;
  type: NodeType;
  gfx: Graphics;
  overlay: HTMLDivElement;
  width: number;
  height: number;
  connectedTo?: string;
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

export function addConnection(sourceId: string, targetId: string): Connection {
  const id = crypto.randomUUID();
  const conn: Connection = { id, sourceId, targetId, element: null };
  connections.set(id, conn);
  const source = nodes.get(sourceId);
  if (source) source.connectedTo = targetId;
  return conn;
}

export function removeConnection(id: string) {
  const conn = connections.get(id);
  if (!conn) return;
  if (conn.element) conn.element.remove();
  const source = nodes.get(conn.sourceId);
  if (source) source.connectedTo = undefined;
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
  }
}

export function getActiveNodeId(): string | null {
  return activeNodeId;
}

export function getLastActiveTerminalId(): string | null {
  // Return only if the terminal still exists
  if (lastActiveTerminalId && nodes.has(lastActiveTerminalId)) {
    return lastActiveTerminalId;
  }
  return null;
}
