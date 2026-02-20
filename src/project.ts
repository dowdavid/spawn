import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Graphics } from 'pixi.js';
import { TITLE_BAR_HEIGHT } from './node';
import {
  registerNode,
  unregisterNode,
  getNode,
  setActiveNodeId,
  getOverlayContainer,
  getAllNodes,
} from './state';
import { blurAllTerminals } from './terminal';
import { resetNodeSize, detachResizeFrame } from './resize';
import {
  borderWidth, cornerRadius, borderDefault, nodeBg, titleBarBg,
  accent, textPrimary, textMuted, textError, textTertiary,
  hoverBg, folderIcon, chevronIcon,
  fontMono, fontSizeBase,
  titleBarPadding, treePaddingY, treeRowPaddingX, treeIndent, treeBaseIndent,
  iconSize, closeBtnPadding, smallRadius,
} from './theme';

interface FileEntry {
  name: string;
  path: string;
  is_directory: boolean;
}

const expandedFolders = new Map<string, Set<string>>();

export interface ProjectData {
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
  initialExpandedFolders?: string[],
): Promise<void> {
  const overlayContainer = getOverlayContainer();

  // Outer wrapper — covers the full node area including border
  const overlay = document.createElement('div');
  overlay.className = 'project-overlay';
  overlay.style.cssText = `
    position:absolute;
    pointer-events:auto;
    overflow:hidden;
    background:${nodeBg};
    border:${borderWidth}px solid ${borderDefault};
    border-radius:${cornerRadius}px;
    box-sizing:border-box;
  `;
  overlayContainer.appendChild(overlay);

  // Title bar div
  const titleBar = document.createElement('div');
  titleBar.style.cssText = `
    width:100%;
    height:${TITLE_BAR_HEIGHT}px;
    background:${titleBarBg};
    cursor:grab;
    border-radius:${cornerRadius - borderWidth}px ${cornerRadius - borderWidth}px 0 0;
    display:flex;
    align-items:center;
    padding:${titleBarPadding};
  `;

  // Drag grip icon (left)
  const gripIcon = document.createElement('div');
  gripIcon.style.cssText = 'display:flex;align-items:center;';
  gripIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="${textMuted}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>`;
  titleBar.appendChild(gripIcon);

  // Project type icon (Lucide FolderOpen)
  const typeIcon = document.createElement('div');
  typeIcon.className = 'node-type-icon';
  typeIcon.style.cssText = 'display:flex;align-items:center;padding-left:2px;';
  typeIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="${textMuted}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>`;
  titleBar.appendChild(typeIcon);

  // Folder name label
  const folderName = dirPath.split('/').pop() || dirPath;
  const label = document.createElement('div');
  label.style.cssText =
    `flex:1;color:${textPrimary};font-family:${fontMono};font-size:${fontSizeBase}px;padding-left:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
  label.textContent = folderName;
  titleBar.appendChild(label);

  // Close button (right)
  const closeBtn = document.createElement('div');
  closeBtn.style.cssText =
    `display:flex;align-items:center;cursor:pointer;padding:${closeBtnPadding}px;border-radius:${smallRadius}px;`;
  closeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="${textMuted}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
  closeBtn.addEventListener('mouseenter', () => {
    closeBtn.querySelector('svg')!.style.stroke = accent.project;
  });
  closeBtn.addEventListener('mouseleave', () => {
    closeBtn.querySelector('svg')!.style.stroke = textMuted;
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
    padding:${treePaddingY}px 0;
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

  titleBar.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    resetNodeSize(id);
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
  expandedFolders.set(id, new Set<string>(initialExpandedFolders ?? []));

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
      `padding:10px 14px;color:${textError};font-family:${fontMono};font-size:${fontSizeBase}px;`;
    errDiv.textContent = 'Failed to read directory';
    container.appendChild(errDiv);
    return;
  }

  const expanded = expandedFolders.get(projectId);

  for (const entry of entries) {
    const row = document.createElement('div');
    row.style.cssText = `
      padding:4px ${treeRowPaddingX}px 4px ${treeBaseIndent + depth * treeIndent}px;
      font-family:${fontMono};
      font-size:${fontSizeBase}px;
      color:${textPrimary};
      cursor:pointer;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
    `;
    row.addEventListener('mouseenter', () => {
      row.style.background = hoverBg;
    });
    row.addEventListener('mouseleave', () => {
      row.style.background = 'transparent';
    });

    // Use flex layout for icon + name
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';

    if (entry.is_directory) {
      const isExpanded = expanded?.has(entry.path) ?? false;
      const chevron = document.createElement('span');
      chevron.style.cssText = 'display:flex;align-items:center;flex-shrink:0;';
      chevron.innerHTML = isExpanded
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="${chevronIcon}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="${chevronIcon}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;
      row.appendChild(chevron);

      const folderIcon = document.createElement('span');
      folderIcon.style.cssText = 'display:flex;align-items:center;flex-shrink:0;';
      folderIcon.innerHTML = isExpanded
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="${folderIcon}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="${folderIcon}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`;
      row.appendChild(folderIcon);

      const nameSpan = document.createElement('span');
      nameSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis;';
      nameSpan.textContent = entry.name;
      row.appendChild(nameSpan);

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
      // Spacer to align with folder chevron
      const spacer = document.createElement('span');
      spacer.style.cssText = `width:${iconSize}px;flex-shrink:0;`;
      row.appendChild(spacer);

      const fileIcon = document.createElement('span');
      fileIcon.style.cssText = 'display:flex;align-items:center;flex-shrink:0;';
      fileIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="${chevronIcon}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>`;
      row.appendChild(fileIcon);

      const nameSpan = document.createElement('span');
      nameSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis;';
      nameSpan.textContent = entry.name;
      row.appendChild(nameSpan);

      row.dataset.filePath = entry.path;
      row.dataset.fileName = entry.name;

      row.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const event = new CustomEvent('open-file-viewer', {
          detail: { filePath: entry.path, fileName: entry.name, projectId },
        });
        window.dispatchEvent(event);
      });
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

export function getProjectData(id: string): ProjectData | undefined {
  return projectData.get(id);
}

export function getExpandedFolders(id: string): Set<string> | undefined {
  return expandedFolders.get(id);
}

export function setActiveProjectNode(id: string | null): void {
  setActiveNodeId(id);
  blurAllTerminals();
  if (id) {
    const entry = getNode(id);
    if (entry) entry.overlay.style.zIndex = `${getAllNodes().length + 1}`;
  }
}

export async function refreshProjectTree(projectId: string): Promise<void> {
  const data = projectData.get(projectId);
  if (!data) return;
  data.treeContainer.innerHTML = '';
  await renderTree(projectId, data.dirPath, data.treeContainer, 0);
}

export async function destroyProjectNode(id: string): Promise<void> {
  const data = projectData.get(id);
  if (data?.unlisten) data.unlisten();
  detachResizeFrame(id);
  await invoke('unwatch_directory', { id }).catch(() => {});
  const entry = getNode(id);
  if (entry) entry.overlay.remove();
  projectData.delete(id);
  expandedFolders.delete(id);
  unregisterNode(id);
}
