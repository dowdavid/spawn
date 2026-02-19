import type { Graphics, Container } from 'pixi.js';
import { invoke } from '@tauri-apps/api/core';
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
  iframe: HTMLIFrameElement | null;
}

const browserData = new Map<string, BrowserData>();

const BORDER_WIDTH = 2;
const CORNER_RADIUS = 8;
const BORDER_DEFAULT = '#0f3460';
const FILL_COLOR = '#16213e';
const TITLE_BAR_COLOR = '#0f2040';
const ACCENT_COLOR = '#f59e0b';

// Default virtual viewport — iframe renders at this width then scales to fit the node.
// 1440px matches a standard desktop resolution so dev server content hits desktop breakpoints.
const VIRTUAL_VIEWPORT_WIDTH = 1440;

function isLocalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'localhost'
      || u.hostname === '127.0.0.1'
      || u.hostname === '0.0.0.0'
      || u.hostname === '[::]';
  } catch {
    return false;
  }
}

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
    padding:0 10px;
    gap:6px;
    position:relative;
    z-index:1;
  `;

  // Drag grip
  const gripIcon = document.createElement('div');
  gripIcon.style.cssText = 'display:flex;align-items:center;';
  gripIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4a5568" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>`;
  titleBar.appendChild(gripIcon);

  // Globe icon
  const typeIcon = document.createElement('div');
  typeIcon.className = 'node-type-icon';
  typeIcon.style.cssText = 'display:flex;align-items:center;';
  typeIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4a5568" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>`;
  titleBar.appendChild(typeIcon);

  // URL input — always visible and editable
  const urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.value = url;
  urlInput.placeholder = 'Enter URL';
  urlInput.style.cssText = 'flex:1;background:#0a1628;border:1px solid #1a3a5c;border-radius:4px;color:#e0e8f0;font-family:Menlo,Monaco,monospace;font-size:14px;padding:4px 10px;outline:none;min-width:0;';
  titleBar.appendChild(urlInput);

  // Hidden label used by BrowserData interface (not displayed)
  const urlLabel = document.createElement('div');
  urlLabel.style.display = 'none';

  urlInput.addEventListener('focus', () => {
    urlInput.style.borderColor = ACCENT_COLOR;
  });
  urlInput.addEventListener('blur', () => {
    urlInput.style.borderColor = '#1a3a5c';
    const newUrl = urlInput.value.trim();
    if (newUrl !== (browserData.get(id)?.url || '')) {
      commitUrl(id, newUrl);
    }
  });
  urlInput.addEventListener('mousedown', (e) => {
    e.stopPropagation();
  });
  urlInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      commitUrl(id, urlInput.value.trim());
      urlInput.blur();
    } else if (e.key === 'Escape') {
      urlInput.value = browserData.get(id)?.url || '';
      urlInput.blur();
    }
  });

  // Refresh button
  const refreshBtn = document.createElement('div');
  refreshBtn.style.cssText = 'display:flex;align-items:center;cursor:pointer;padding:2px;border-radius:4px;flex-shrink:0;';
  refreshBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4a5568" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>`;
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

  // Content area
  const contentArea = document.createElement('div');
  contentArea.style.cssText = `
    width:100%;
    height:calc(100% - ${TITLE_BAR_HEIGHT}px);
    overflow:hidden;
    display:flex;
    align-items:center;
    justify-content:center;
    box-sizing:border-box;
    position:relative;
  `;
  overlay.appendChild(contentArea);

  // Status text
  const statusText = document.createElement('div');
  statusText.style.cssText = 'color:#4a5568;font-family:Menlo,Monaco,monospace;font-size:15px;text-align:center;padding:24px;';
  statusText.textContent = url ? '' : connectedTerminalId ? 'Starting dev server...' : 'No URL — enter a URL above';
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

  contentArea.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    const parent = gfx.parent;
    if (parent) parent.setChildIndex(gfx, parent.children.length - 1);
    blurAllTerminals();
    setActiveNodeId(id);
    overlay.style.zIndex = `${getAllNodes().length + 1}`;
  });

  const data: BrowserData = { url, connectedTerminalId, urlLabel, urlInput, contentArea, statusText, iframe: null };
  browserData.set(id, data);

  registerNode({
    id,
    type: 'browser',
    gfx,
    overlay,
    width: nodeWidth,
    height: nodeHeight,
  });

  if (url) {
    loadUrl(id, url);
  }
}

function loadUrl(id: string, url: string): void {
  const data = browserData.get(id);
  if (!data) return;

  // Remove existing iframe and its observer
  if (data.iframe) {
    const obs = (data.iframe as any)._resizeObserver as ResizeObserver | undefined;
    if (obs) obs.disconnect();
    data.iframe.remove();
    data.iframe = null;
  }

  // Clear any previous fallback content
  data.contentArea.innerHTML = '';
  data.contentArea.appendChild(data.statusText);
  data.statusText.textContent = '';

  if (isLocalUrl(url)) {
    // Localhost — render at a virtual desktop viewport then scale to fit the node
    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.style.cssText = `
      position:absolute;
      top:0;left:0;
      border:none;
      background:#fff;
      transform-origin:top left;
      border-radius:0 0 ${CORNER_RADIUS - BORDER_WIDTH}px ${CORNER_RADIUS - BORDER_WIDTH}px;
    `;
    data.contentArea.appendChild(iframe);
    data.iframe = iframe;

    // Scale the iframe to fit the content area
    const applyScale = () => {
      const cw = data.contentArea.clientWidth;
      const ch = data.contentArea.clientHeight;
      if (cw <= 0 || ch <= 0) return;

      // If the node is wider than the virtual viewport, render at native size
      const vw = Math.max(cw, VIRTUAL_VIEWPORT_WIDTH);
      const scale = cw / vw;
      // Proportional height so the scaled iframe fills the content area exactly
      const vh = ch / scale;

      iframe.style.width = `${vw}px`;
      iframe.style.height = `${vh}px`;
      iframe.style.transform = `scale(${scale})`;
    };

    applyScale();

    // Recalculate on node resize
    const observer = new ResizeObserver(applyScale);
    observer.observe(data.contentArea);

    // Store observer for cleanup
    (iframe as any)._resizeObserver = observer;
  } else {
    // External URL — show info with "Open in Browser" button
    const fallback = document.createElement('div');
    fallback.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:16px;padding:30px;width:100%;';

    const icon = document.createElement('div');
    icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#4a5568" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>`;
    fallback.appendChild(icon);

    const msg = document.createElement('div');
    msg.style.cssText = 'color:#6a7a8a;font-family:Menlo,Monaco,monospace;font-size:13px;text-align:center;max-width:300px;line-height:1.5;';
    msg.textContent = 'External sites block iframe embedding. Localhost URLs (dev servers) load directly in the node.';
    fallback.appendChild(msg);

    const openBtn = document.createElement('button');
    openBtn.textContent = 'Open in System Browser';
    openBtn.style.cssText = `
      background:${ACCENT_COLOR};color:#000;border:none;border-radius:6px;
      padding:10px 22px;font-family:Menlo,Monaco,monospace;font-size:14px;
      font-weight:600;cursor:pointer;transition:opacity 0.15s;
    `;
    openBtn.addEventListener('mouseenter', () => { openBtn.style.opacity = '0.85'; });
    openBtn.addEventListener('mouseleave', () => { openBtn.style.opacity = '1'; });
    openBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      invoke('open_file_in_system', { path: url }).catch(() => {
        window.open(url, '_blank');
      });
    });
    fallback.appendChild(openBtn);

    const urlHint = document.createElement('div');
    urlHint.style.cssText = 'color:#3a4a5a;font-family:Menlo,Monaco,monospace;font-size:12px;word-break:break-all;text-align:center;max-width:300px;';
    urlHint.textContent = url;
    fallback.appendChild(urlHint);

    data.contentArea.appendChild(fallback);
  }
}

function commitUrl(id: string, newUrl: string): void {
  const data = browserData.get(id);
  if (!data) return;
  data.url = newUrl;
  data.urlInput.value = newUrl;

  if (newUrl) {
    loadUrl(id, newUrl);
  } else {
    if (data.iframe) {
      data.iframe.remove();
      data.iframe = null;
    }
    data.contentArea.innerHTML = '';
    data.contentArea.appendChild(data.statusText);
    data.statusText.textContent = 'No URL — press Cmd+B or enter a URL above';
    data.statusText.style.color = '#4a5568';
  }
}

export function refreshBrowser(id: string): void {
  const data = browserData.get(id);
  if (!data || !data.url) return;
  loadUrl(id, data.url);
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
  const data = browserData.get(id);
  if (data?.iframe) {
    const obs = (data.iframe as any)._resizeObserver as ResizeObserver | undefined;
    if (obs) obs.disconnect();
    data.iframe.remove();
  }
  browserData.delete(id);
  unregisterNode(id);
}

// No-op — iframes live inside the DOM overlay, no native positioning needed
export function syncBrowserWebviews(_world: Container): void {}
