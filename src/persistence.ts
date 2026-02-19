import type { Container } from 'pixi.js';
import {
  getAllNodes,
  getAllConnections,
  getActiveNodeId,
  addConnectionWithId,
} from './state';
import { createNodeWithId } from './node';
import { createTerminalNode, getTerminalData, setActiveNode } from './terminal';
import { createProjectNode, getProjectPath, getExpandedFolders } from './project';
import { createViewerNode, getViewerData } from './viewer';
import { setTargetScale } from './canvas';

// --- Serialized types ---

interface SerializedTerminal {
  cwd?: string;
  connectedProjectPath?: string;
}

interface SerializedProject {
  dirPath: string;
  expandedFolders: string[];
}

interface SerializedViewer {
  filePath: string;
  fileName: string;
}

interface SerializedNode {
  id: string;
  type: 'terminal' | 'project' | 'viewer' | 'browser';
  x: number;
  y: number;
  width: number;
  height: number;
  terminal?: SerializedTerminal;
  project?: SerializedProject;
  viewer?: SerializedViewer;
}

interface SerializedConnection {
  id: string;
  sourceId: string;
  targetId: string;
}

interface WorkspaceState {
  nodes: SerializedNode[];
  connections: SerializedConnection[];
  viewport: { x: number; y: number; scale: number };
  activeNodeId: string | null;
}

// --- Gather ---

export function gatherWorkspaceState(world: Container): WorkspaceState {
  const nodes: SerializedNode[] = [];

  for (const entry of getAllNodes()) {
    const base: SerializedNode = {
      id: entry.id,
      type: entry.type,
      x: entry.gfx.x,
      y: entry.gfx.y,
      width: entry.width,
      height: entry.height,
    };

    if (entry.type === 'terminal') {
      const td = getTerminalData(entry.id);
      if (td) {
        base.terminal = {
          cwd: td.cwd,
          connectedProjectPath: td.connectedProjectPath,
        };
      }
    } else if (entry.type === 'project') {
      const dirPath = getProjectPath(entry.id);
      const expanded = getExpandedFolders(entry.id);
      if (dirPath) {
        base.project = {
          dirPath,
          expandedFolders: expanded ? Array.from(expanded) : [],
        };
      }
    } else if (entry.type === 'viewer') {
      const vd = getViewerData(entry.id);
      if (vd) {
        base.viewer = { filePath: vd.filePath, fileName: vd.fileName };
      }
    }

    nodes.push(base);
  }

  const connections: SerializedConnection[] = getAllConnections().map((c) => ({
    id: c.id,
    sourceId: c.sourceId,
    targetId: c.targetId,
  }));

  return {
    nodes,
    connections,
    viewport: {
      x: world.x,
      y: world.y,
      scale: world.scale.x,
    },
    activeNodeId: getActiveNodeId(),
  };
}

// --- Restore ---

export async function restoreWorkspaceState(
  state: WorkspaceState,
  world: Container,
): Promise<void> {
  // Restore viewport first
  world.x = state.viewport.x;
  world.y = state.viewport.y;
  world.scale.set(state.viewport.scale);
  setTargetScale(state.viewport.scale);

  // Separate nodes by type — projects first (terminals may reference them via cwd)
  const projectNodes = state.nodes.filter((n) => n.type === 'project');
  const terminalNodes = state.nodes.filter((n) => n.type === 'terminal');
  const viewerNodes = state.nodes.filter((n) => n.type === 'viewer');

  // Restore projects
  for (const n of projectNodes) {
    if (!n.project) continue;
    const handle = createNodeWithId(world, n.x, n.y, n.id);
    await createProjectNode(
      handle.id,
      handle.gfx,
      n.width,
      n.height,
      n.project.dirPath,
      n.project.expandedFolders,
    );
  }

  // Restore terminals
  for (const n of terminalNodes) {
    const handle = createNodeWithId(world, n.x, n.y, n.id);
    await createTerminalNode(
      handle.id,
      handle.gfx,
      n.width,
      n.height,
      n.terminal?.cwd,
      n.terminal?.connectedProjectPath,
    );
  }

  // Restore viewers
  for (const n of viewerNodes) {
    if (!n.viewer) continue;
    const handle = createNodeWithId(world, n.x, n.y, n.id);
    await createViewerNode(
      handle.id,
      handle.gfx,
      n.width,
      n.height,
      n.viewer.filePath,
      n.viewer.fileName,
    );
  }

  // Restore connections
  for (const c of state.connections) {
    addConnectionWithId(c.id, c.sourceId, c.targetId);
  }

  // Restore active node
  if (state.activeNodeId) {
    setActiveNode(state.activeNodeId);
  }
}
