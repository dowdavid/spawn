import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Graphics } from 'pixi.js';
import { TITLE_BAR_HEIGHT } from './node';
import {
  registerNode,
  unregisterNode,
  getNode,
  setActiveNodeId,
  getActiveNodeId,
  getOverlayContainer,
  getAllNodes,
} from './state';

interface FileEntry {
  name: string;
  path: string;
  is_directory: boolean;
}

const BORDER_WIDTH = 2;
const CORNER_RADIUS = 8;

const BORDER_DEFAULT = '#0f3460';
const BORDER_FOCUSED = '#e94560';
const FILL_COLOR = '#16213e';
const TITLE_BAR_COLOR = '#0f2040';

const expandedFolders = new Map<string, Set<string>>();

interface ProjectData {
  dirPath: string;
  treeContainer: HTMLDivElement;
  unlisten: UnlistenFn | null;
}
const projectData = new Map<string, ProjectData>();

export async function createProjectNode(
  id: string,
  gfx: Graphics,
  nodeWidth: number,
  nodeHeight: number,
  dirPath: string,
): Promise<void> {
  const overlayContainer = getOverlayContainer();

  // Outer wrapper — covers the full node area including border
  const overlay = document.createElement('div');
  overlay.className = 'project-overlay';
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

  // Folder name label
  const folderName = dirPath.split('/').pop() || dirPath;
  const label = document.createElement('div');
  label.style.cssText =
    'flex:1;color:#c0c8d0;font-family:Menlo,Monaco,"Courier New",monospace;font-size:12px;padding-left:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  label.textContent = folderName;
  titleBar.appendChild(label);

  // Close button (right)
  const closeBtn = document.createElement('div');
  closeBtn.style.cssText =
    'display:flex;align-items:center;cursor:pointer;padding:2px;border-radius:4px;';
  closeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4a5568" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
  closeBtn.addEventListener('mouseenter', () => {
    closeBtn.querySelector('svg')!.style.stroke = '#e94560';
  });
  closeBtn.addEventListener('mouseleave', () => {
    closeBtn.querySelector('svg')!.style.stroke = '#4a5568';
  });
  closeBtn.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    destroyProjectNode(id);
    const parent = gfx.parent;
    if (parent) parent.removeChild(gfx);
  });
  titleBar.appendChild(closeBtn);

  overlay.appendChild(titleBar);

  // File tree container — scrollable area below title bar
  const treeContainer = document.createElement('div');
  treeContainer.style.cssText = `
    width:100%;
    height:calc(100% - ${TITLE_BAR_HEIGHT}px);
    overflow-y:auto;
    overflow-x:hidden;
    padding:6px 0;
    box-sizing:border-box;
  `;
  overlay.appendChild(treeContainer);

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
    setActiveProjectNode(id);

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

  // Click tree area to focus
  treeContainer.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    const parent = gfx.parent;
    if (parent) {
      parent.setChildIndex(gfx, parent.children.length - 1);
    }
    setActiveProjectNode(id);
  });

  // Set overlay dimensions
  overlay.style.width = `${nodeWidth}px`;
  overlay.style.height = `${nodeHeight}px`;

  // Register in centralized state
  registerNode({
    id,
    type: 'project',
    gfx,
    overlay,
    width: nodeWidth,
    height: nodeHeight,
  });

  // Initialize expanded folders set for this project
  expandedFolders.set(id, new Set<string>());

  // Render the initial file tree
  await renderTree(id, dirPath, treeContainer, 0);

  // Start file watcher
  await invoke('watch_directory', { id, path: dirPath });

  // Debounced refresh on file changes
  let refreshTimeout: ReturnType<typeof setTimeout> | null = null;
  const unlisten = await listen<{ path: string; kind: string }>(
    `file-changed-${id}`,
    () => {
      if (refreshTimeout) clearTimeout(refreshTimeout);
      refreshTimeout = setTimeout(() => refreshProjectTree(id), 300);
    },
  );

  // Store project-specific data locally
  projectData.set(id, { dirPath, treeContainer, unlisten });
}

async function renderTree(
  projectId: string,
  dirPath: string,
  container: HTMLDivElement,
  depth: number,
): Promise<void> {
  let entries: FileEntry[];
  try {
    entries = await invoke<FileEntry[]>('read_directory', { path: dirPath });
  } catch {
    const errDiv = document.createElement('div');
    errDiv.style.cssText =
      'padding:8px 12px;color:#e94560;font-family:Menlo,Monaco,"Courier New",monospace;font-size:12px;';
    errDiv.textContent = 'Failed to read directory';
    container.appendChild(errDiv);
    return;
  }

  const expanded = expandedFolders.get(projectId);

  for (const entry of entries) {
    const row = document.createElement('div');
    row.style.cssText = `
      padding:3px 8px 3px ${12 + depth * 16}px;
      font-family:Menlo,Monaco,"Courier New",monospace;
      font-size:12px;
      color:#c0c8d0;
      cursor:pointer;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
    `;
    row.addEventListener('mouseenter', () => {
      row.style.background = '#1a2a40';
    });
    row.addEventListener('mouseleave', () => {
      row.style.background = 'transparent';
    });

    if (entry.is_directory) {
      const isExpanded = expanded?.has(entry.path) ?? false;
      const arrow = isExpanded ? '\u25BC' : '\u25B6';
      row.textContent = `${arrow} ${entry.name}`;

      row.addEventListener('click', (e) => {
        e.stopPropagation();
        const exp = expandedFolders.get(projectId);
        if (!exp) return;

        if (exp.has(entry.path)) {
          exp.delete(entry.path);
        } else {
          exp.add(entry.path);
        }

        // Re-render: clear everything after this row's parent scope and re-render
        // For simplicity, re-render the whole tree
        refreshProjectTree(projectId);
      });
    } else {
      // File entry — indent with spacer to align with folder names
      row.textContent = `\u00A0\u00A0${entry.name}`;
      row.dataset.filePath = entry.path;
      row.dataset.fileName = entry.name;
    }

    container.appendChild(row);

    // If this is an expanded directory, render its children immediately after
    if (entry.is_directory && expanded?.has(entry.path)) {
      await renderTree(projectId, entry.path, container, depth + 1);
    }
  }
}

export function getProjectPath(id: string): string | undefined {
  return projectData.get(id)?.dirPath;
}

export function setActiveProjectNode(id: string | null): void {
  setActiveNodeId(id);
  const allNodes = getAllNodes();
  for (const entry of allNodes) {
    if (entry.type !== 'project') continue;
    if (entry.id === id) {
      entry.overlay.style.borderColor = BORDER_FOCUSED;
      entry.overlay.style.zIndex = `${allNodes.length + 1}`;
    } else {
      entry.overlay.style.borderColor = BORDER_DEFAULT;
    }
  }
}

export function refreshProjectTree(projectId: string): void {
  const data = projectData.get(projectId);
  if (!data) return;
  data.treeContainer.innerHTML = '';
  renderTree(projectId, data.dirPath, data.treeContainer, 0);
}

export async function destroyProjectNode(id: string): Promise<void> {
  const data = projectData.get(id);
  if (data?.unlisten) data.unlisten();
  await invoke('unwatch_directory', { id }).catch(() => {});
  const entry = getNode(id);
  if (entry) entry.overlay.remove();
  projectData.delete(id);
  expandedFolders.delete(id);
  unregisterNode(id);
}
