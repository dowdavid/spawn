import { invoke } from '@tauri-apps/api/core';
import type { Graphics } from 'pixi.js';
import { TITLE_BAR_HEIGHT } from './node';
import {
  registerNode,
  unregisterNode,
  getNode,
  setActiveNodeId,
  getAllNodes,
  getOverlayContainer,
} from './state';
import { blurAllTerminals } from './terminal';
import { resetNodeSize, detachResizeFrame } from './resize';

export interface ViewerData {
  filePath: string;
  fileName: string;
}

const viewerData = new Map<string, ViewerData>();

const BORDER_WIDTH = 2;
const CORNER_RADIUS = 8;
const BORDER_DEFAULT = '#0f3460';
const BORDER_FOCUSED = '#34d399';
const FILL_COLOR = '#16213e';
const TITLE_BAR_COLOR = '#0f2040';

export async function createViewerNode(
  id: string,
  gfx: Graphics,
  nodeWidth: number,
  nodeHeight: number,
  filePath: string,
  fileName: string,
): Promise<void> {
  const overlay = document.createElement('div');
  overlay.className = 'viewer-overlay';
  overlay.style.cssText = `
    position:absolute;
    pointer-events:auto;
    overflow:hidden;
    background:${FILL_COLOR};
    border:${BORDER_WIDTH}px solid ${BORDER_DEFAULT};
    border-radius:${CORNER_RADIUS}px;
    box-sizing:border-box;
  `;
  overlay.style.width = `${nodeWidth}px`;
  overlay.style.height = `${nodeHeight}px`;
  getOverlayContainer().appendChild(overlay);

  // Title bar
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
    gap:6px;
  `;

  // Drag grip
  const gripIcon = document.createElement('div');
  gripIcon.style.cssText = 'display:flex;align-items:center;';
  gripIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4a5568" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>`;
  titleBar.appendChild(gripIcon);

  // Document icon (Lucide FileText)
  const docIcon = document.createElement('div');
  docIcon.className = 'node-type-icon';
  docIcon.style.cssText = 'display:flex;align-items:center;';
  docIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4a5568" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 13H8"/><path d="M16 13h-2"/><path d="M10 17H8"/><path d="M16 17h-2"/></svg>`;
  titleBar.appendChild(docIcon);

  // File name label
  const titleLabel = document.createElement('div');
  titleLabel.style.cssText = 'flex:1;color:#8899aa;font-family:Menlo,Monaco,monospace;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  titleLabel.textContent = fileName;
  titleBar.appendChild(titleLabel);

  // Close button
  const closeBtn = document.createElement('div');
  closeBtn.style.cssText = 'display:flex;align-items:center;cursor:pointer;padding:2px;border-radius:4px;';
  closeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4a5568" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
  closeBtn.addEventListener('mouseenter', () => { closeBtn.querySelector('svg')!.style.stroke = '#34d399'; });
  closeBtn.addEventListener('mouseleave', () => { closeBtn.querySelector('svg')!.style.stroke = '#4a5568'; });
  closeBtn.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    destroyViewerNode(id);
    const parent = gfx.parent;
    if (parent) parent.removeChild(gfx);
  });
  titleBar.appendChild(closeBtn);
  overlay.appendChild(titleBar);

  // Code content area
  const codeContainer = document.createElement('div');
  codeContainer.style.cssText = `
    width:100%;
    height:calc(100% - ${TITLE_BAR_HEIGHT}px);
    overflow:auto;
    padding:12px;
    box-sizing:border-box;
  `;
  overlay.appendChild(codeContainer);

  // Load file contents
  try {
    const contents = await invoke<string>('read_file_contents', { path: filePath });
    const pre = document.createElement('pre');
    pre.style.cssText = `
      margin:0;
      font-family:Menlo,Monaco,"Courier New",monospace;
      font-size:13px;
      color:#e0e0e0;
      line-height:1.5;
      white-space:pre;
      tab-size:4;
    `;
    pre.textContent = contents;
    codeContainer.appendChild(pre);
  } catch {
    codeContainer.style.cssText += 'color:#e94560;font-size:12px;font-family:Menlo,monospace;';
    codeContainer.textContent = 'Failed to read file';
  }

  // Title bar drag
  let dragging = false;
  let dragStartWorldX = 0;
  let dragStartWorldY = 0;
  let gfxStartX = 0;
  let gfxStartY = 0;

  titleBar.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const parent = gfx.parent;
    if (parent) parent.setChildIndex(gfx, parent.children.length - 1);
    blurAllTerminals();
    setActiveNodeId(id);
    overlay.style.zIndex = `${getAllNodes().length + 1}`;
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

  codeContainer.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    const parent = gfx.parent;
    if (parent) parent.setChildIndex(gfx, parent.children.length - 1);
    blurAllTerminals();
    setActiveNodeId(id);
    overlay.style.zIndex = `${getAllNodes().length + 1}`;
  });

  viewerData.set(id, { filePath, fileName });

  registerNode({
    id,
    type: 'viewer',
    gfx,
    overlay,
    width: nodeWidth,
    height: nodeHeight,
  });
}

export function setActiveViewerNode(id: string): void {
  blurAllTerminals();
  setActiveNodeId(id);
  const entry = getNode(id);
  if (!entry) return;
  entry.overlay.style.zIndex = `${getAllNodes().length + 1}`;
  const parent = entry.gfx.parent;
  if (parent) parent.setChildIndex(entry.gfx, parent.children.length - 1);
}

export function getViewerData(id: string): ViewerData | undefined {
  return viewerData.get(id);
}

export function destroyViewerNode(id: string) {
  detachResizeFrame(id);
  const entry = getNode(id);
  if (entry) entry.overlay.remove();
  viewerData.delete(id);
  unregisterNode(id);
}
