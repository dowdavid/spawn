import type { Graphics, Container } from 'pixi.js';
import { TITLE_BAR_HEIGHT } from './node';
import {
  registerNode,
  unregisterNode,
  getNode,
  setActiveNodeId,
  getActiveNodeId,
  getAllNodes,
  getOverlayContainer,
} from './state';
import { blurAllTerminals } from './terminal';
import { resetNodeSize, detachResizeFrame } from './resize';

export interface BrowserData {
  url: string;
  connectedTerminalId: string | null;
  urlLabel: HTMLDivElement;
  urlInput: HTMLInputElement;
  contentArea: HTMLDivElement;
  statusText: HTMLDivElement;
}

const browserData = new Map<string, BrowserData>();

const BORDER_WIDTH = 2;
const CORNER_RADIUS = 8;
const BORDER_DEFAULT = '#0f3460';
const FILL_COLOR = '#16213e';
const TITLE_BAR_COLOR = '#0f2040';
const ACCENT_COLOR = '#f59e0b';

export async function createBrowserNode(
  id: string,
  gfx: Graphics,
  nodeWidth: number,
  nodeHeight: number,
  url: string = '',
  connectedTerminalId: string | null = null,
): Promise<void> {
  const overlay = document.createElement('div');
  overlay.className = 'browser-overlay';
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
    gap:4px;
  `;

  // Drag grip
  const gripIcon = document.createElement('div');
  gripIcon.style.cssText = 'display:flex;align-items:center;';
  gripIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4a5568" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>`;
  titleBar.appendChild(gripIcon);

  // Globe icon (Lucide Globe)
  const typeIcon = document.createElement('div');
  typeIcon.className = 'node-type-icon';
  typeIcon.style.cssText = 'display:flex;align-items:center;';
  typeIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4a5568" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>`;
  titleBar.appendChild(typeIcon);

  // URL label (static text, click to edit)
  const urlLabel = document.createElement('div');
  urlLabel.style.cssText = 'flex:1;color:#8899aa;font-family:Menlo,Monaco,monospace;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:text;min-width:0;';
  urlLabel.textContent = url || 'Enter URL...';
  if (!url) urlLabel.style.color = '#4a5568';
  titleBar.appendChild(urlLabel);

  // URL input (hidden by default, shown on click)
  const urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.value = url;
  urlInput.placeholder = 'Enter URL...';
  urlInput.style.cssText = 'display:none;flex:1;background:#0a1628;border:1px solid #1a3a5c;border-radius:4px;color:#c0c8d0;font-family:Menlo,Monaco,monospace;font-size:11px;padding:2px 6px;outline:none;min-width:0;';
  titleBar.appendChild(urlInput);

  // Click URL label to switch to edit mode
  urlLabel.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    urlLabel.style.display = 'none';
    urlInput.style.display = 'block';
    urlInput.focus();
    urlInput.select();
  });

  // Enter to navigate, Escape to cancel
  urlInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const newUrl = urlInput.value.trim();
      commitUrl(id, newUrl);
      urlInput.style.display = 'none';
      urlLabel.style.display = 'block';
    } else if (e.key === 'Escape') {
      urlInput.value = browserData.get(id)?.url || '';
      urlInput.style.display = 'none';
      urlLabel.style.display = 'block';
    }
  });

  urlInput.addEventListener('blur', () => {
    urlInput.style.display = 'none';
    urlLabel.style.display = 'block';
  });

  // Refresh button (Lucide RotateCw)
  const refreshBtn = document.createElement('div');
  refreshBtn.style.cssText = 'display:flex;align-items:center;cursor:pointer;padding:2px;border-radius:4px;flex-shrink:0;';
  refreshBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4a5568" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>`;
  refreshBtn.addEventListener('mouseenter', () => { refreshBtn.querySelector('svg')!.style.stroke = ACCENT_COLOR; });
  refreshBtn.addEventListener('mouseleave', () => { refreshBtn.querySelector('svg')!.style.stroke = '#4a5568'; });
  refreshBtn.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    refreshBrowser(id);
  });
  titleBar.appendChild(refreshBtn);

  // Close button
  const closeBtn = document.createElement('div');
  closeBtn.style.cssText = 'display:flex;align-items:center;cursor:pointer;padding:2px;border-radius:4px;flex-shrink:0;';
  closeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4a5568" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
  closeBtn.addEventListener('mouseenter', () => { closeBtn.querySelector('svg')!.style.stroke = ACCENT_COLOR; });
  closeBtn.addEventListener('mouseleave', () => { closeBtn.querySelector('svg')!.style.stroke = '#4a5568'; });
  closeBtn.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    destroyBrowserNode(id);
    const parent = gfx.parent;
    if (parent) parent.removeChild(gfx);
  });
  titleBar.appendChild(closeBtn);

  overlay.appendChild(titleBar);

  // Content area — placeholder for now, webview added in Task 6
  const contentArea = document.createElement('div');
  contentArea.style.cssText = `
    width:100%;
    height:calc(100% - ${TITLE_BAR_HEIGHT}px);
    overflow:hidden;
    display:flex;
    align-items:center;
    justify-content:center;
    box-sizing:border-box;
  `;
  overlay.appendChild(contentArea);

  // Status text (shown when no URL or waiting for server)
  const statusText = document.createElement('div');
  statusText.style.cssText = 'color:#4a5568;font-family:Menlo,Monaco,monospace;font-size:13px;text-align:center;padding:20px;';
  statusText.textContent = url ? 'Loading...' : 'No URL — press Cmd+B or enter a URL above';
  contentArea.appendChild(statusText);

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

  // Click content area to focus
  contentArea.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    const parent = gfx.parent;
    if (parent) parent.setChildIndex(gfx, parent.children.length - 1);
    blurAllTerminals();
    setActiveNodeId(id);
    overlay.style.zIndex = `${getAllNodes().length + 1}`;
  });

  browserData.set(id, { url, connectedTerminalId, urlLabel, urlInput, contentArea, statusText });

  registerNode({
    id,
    type: 'browser',
    gfx,
    overlay,
    width: nodeWidth,
    height: nodeHeight,
  });
}

function commitUrl(id: string, newUrl: string): void {
  const data = browserData.get(id);
  if (!data) return;
  data.url = newUrl;
  data.urlLabel.textContent = newUrl || 'Enter URL...';
  data.urlLabel.style.color = newUrl ? '#8899aa' : '#4a5568';
  data.urlInput.value = newUrl;
  if (newUrl) {
    data.statusText.textContent = 'Loading...';
    // Webview navigation added in Task 6
  } else {
    data.statusText.textContent = 'No URL — press Cmd+B or enter a URL above';
  }
}

export function refreshBrowser(id: string): void {
  const data = browserData.get(id);
  if (!data || !data.url) return;
  data.statusText.textContent = 'Refreshing...';
  // Webview reload added in Task 6
}

export function setBrowserUrl(id: string, url: string): void {
  commitUrl(id, url);
}

export function setActiveBrowserNode(id: string): void {
  blurAllTerminals();
  setActiveNodeId(id);
  const entry = getNode(id);
  if (!entry) return;
  entry.overlay.style.zIndex = `${getAllNodes().length + 1}`;
  const parent = entry.gfx.parent;
  if (parent) parent.setChildIndex(entry.gfx, parent.children.length - 1);
}

export function focusUrlInput(id: string): void {
  const data = browserData.get(id);
  if (!data) return;
  data.urlLabel.style.display = 'none';
  data.urlInput.style.display = 'block';
  data.urlInput.focus();
  data.urlInput.select();
}

export function getBrowserData(id: string): BrowserData | undefined {
  return browserData.get(id);
}

export function getBrowserForTerminal(terminalId: string): string | null {
  for (const [id, data] of browserData) {
    if (data.connectedTerminalId === terminalId) return id;
  }
  return null;
}

export function destroyBrowserNode(id: string): void {
  detachResizeFrame(id);
  const entry = getNode(id);
  if (entry) entry.overlay.remove();
  // Webview cleanup added in Task 6
  browserData.delete(id);
  unregisterNode(id);
}

// Webview sync — placeholder for Task 6
export function syncBrowserWebviews(_world: Container): void {
  // Will be implemented in Task 6 with Tauri child webviews
}
