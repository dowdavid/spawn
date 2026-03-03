import { invoke } from '@tauri-apps/api/core';
import type { Graphics } from 'pixi.js';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { keymap } from '@codemirror/view';
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
import {
  borderWidth, cornerRadius, borderDefault, nodeBg, titleBarBg,
  editorAccent, textSecondary, textMuted, textError,
  fontMono, fontSizeBase, fontSizeCode,
  titleBarPadding, iconSize, closeBtnPadding, smallRadius,
} from './theme';

export interface EditorData {
  filePath: string;
  fileName: string;
  editorView: EditorView;
  dirty: boolean;
}

const editorData = new Map<string, EditorData>();
const recentWrites = new Map<string, number>();
const flashingNodes = new Set<string>();

export function isFlashing(id: string): boolean {
  return flashingNodes.has(id);
}

function getLanguageExtension(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'ts': return javascript({ typescript: true });
    case 'tsx': return javascript({ typescript: true, jsx: true });
    case 'js': return javascript();
    case 'jsx': return javascript({ jsx: true });
    case 'css': case 'scss': return css();
    case 'html': return html();
    case 'json': return json();
    case 'md': case 'markdown': return markdown();
    default: return [];
  }
}

export async function saveFile(id: string, flash = false): Promise<boolean> {
  const data = editorData.get(id);
  if (!data) return false;
  if (!data.dirty) {
    if (flash) flashSaveBorder(id);
    return true;
  }
  const contents = data.editorView.state.doc.toString();
  try {
    recentWrites.set(data.filePath, Date.now());
    await invoke('write_file_contents', { path: data.filePath, contents });
    data.dirty = false;
    updateTitleDirtyState(id);
    flashSaveBorder(id);
    return true;
  } catch (err) {
    console.error('Failed to save file:', err);
    showSaveError(id);
    return false;
  }
}

function updateTitleDirtyState(id: string) {
  const data = editorData.get(id);
  if (!data) return;
  const entry = getNode(id);
  if (!entry) return;
  const label = entry.overlay.querySelector('.editor-title-label') as HTMLElement;
  if (label) {
    label.textContent = data.dirty ? `● ${data.fileName}` : data.fileName;
  }
}

function flashSaveBorder(id: string) {
  const entry = getNode(id);
  if (!entry) return;
  const bright = '#93c5fd';
  flashingNodes.add(id);
  entry.overlay.style.borderColor = bright;
  entry.overlay.style.transition = 'border-color 0.3s ease';
  setTimeout(() => {
    flashingNodes.delete(id);
    entry.overlay.style.transition = 'border-color 0.3s ease';
    setTimeout(() => { entry.overlay.style.transition = ''; }, 300);
  }, 300);
}

function showSaveError(id: string) {
  const entry = getNode(id);
  if (!entry) return;
  const label = entry.overlay.querySelector('.editor-title-label') as HTMLElement;
  if (!label) return;
  const prevColor = label.style.color;
  label.style.color = textError;
  label.textContent = '⚠ Save failed';
  setTimeout(() => {
    label.style.color = prevColor;
    updateTitleDirtyState(id);
  }, 2000);
}

export async function createEditorNode(
  id: string,
  gfx: Graphics,
  nodeWidth: number,
  nodeHeight: number,
  filePath: string,
  fileName: string,
): Promise<void> {
  const overlay = document.createElement('div');
  overlay.className = 'editor-overlay';
  overlay.style.cssText = `
    position:absolute;
    pointer-events:auto;
    overflow:hidden;
    background:${nodeBg};
    border:${borderWidth}px solid ${borderDefault};
    border-radius:${cornerRadius}px;
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
    background:${titleBarBg};
    cursor:grab;
    border-radius:${cornerRadius - borderWidth}px ${cornerRadius - borderWidth}px 0 0;
    display:flex;
    align-items:center;
    padding:${titleBarPadding};
    gap:8px;
  `;

  // Drag grip
  const gripIcon = document.createElement('div');
  gripIcon.style.cssText = 'display:flex;align-items:center;';
  gripIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="${textMuted}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>`;
  titleBar.appendChild(gripIcon);

  // Edit icon (Lucide Pencil)
  const editIcon = document.createElement('div');
  editIcon.className = 'node-type-icon';
  editIcon.style.cssText = 'display:flex;align-items:center;';
  editIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="${textMuted}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/></svg>`;
  titleBar.appendChild(editIcon);

  // File name label
  const titleLabel = document.createElement('div');
  titleLabel.className = 'editor-title-label';
  titleLabel.style.cssText = `flex:1;color:${textSecondary};font-family:${fontMono};font-size:${fontSizeBase}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
  titleLabel.textContent = fileName;
  titleBar.appendChild(titleLabel);

  // Close button
  const closeBtn = document.createElement('div');
  closeBtn.style.cssText = `display:flex;align-items:center;cursor:pointer;padding:${closeBtnPadding}px;border-radius:${smallRadius}px;`;
  closeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="${textMuted}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
  closeBtn.addEventListener('mouseenter', () => { closeBtn.querySelector('svg')!.style.stroke = editorAccent; });
  closeBtn.addEventListener('mouseleave', () => { closeBtn.querySelector('svg')!.style.stroke = textMuted; });
  closeBtn.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    destroyEditorNode(id);
    const parent = gfx.parent;
    if (parent) parent.removeChild(gfx);
  });
  titleBar.appendChild(closeBtn);
  overlay.appendChild(titleBar);

  // Editor container
  const editorContainer = document.createElement('div');
  editorContainer.style.cssText = `
    width:100%;
    height:calc(100% - ${TITLE_BAR_HEIGHT}px);
    overflow:hidden;
    box-sizing:border-box;
  `;
  overlay.appendChild(editorContainer);

  // Auto-save debounce
  let autoSaveTimeout: ReturnType<typeof setTimeout> | null = null;

  // Load file and create CodeMirror
  let editorView: EditorView;
  try {
    const contents = await invoke<string>('read_file_contents', { path: filePath });
    const langExt = getLanguageExtension(fileName);

    editorView = new EditorView({
      state: EditorState.create({
        doc: contents,
        extensions: [
          basicSetup,
          oneDark,
          ...(Array.isArray(langExt) ? langExt : [langExt]),
          keymap.of([{
            key: 'Mod-s',
            run: () => { saveFile(id, true); return true; },
          }]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const data = editorData.get(id);
              if (data && !data.dirty) {
                data.dirty = true;
                updateTitleDirtyState(id);
              }
              if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
              autoSaveTimeout = setTimeout(() => saveFile(id), 1000);
            }
          }),
          EditorView.theme({
            '&': { height: '100%', fontSize: `${fontSizeCode}px` },
            '.cm-scroller': { overflow: 'auto', fontFamily: fontMono },
            '.cm-content': { caretColor: editorAccent },
            '&.cm-focused': { outline: 'none' },
          }),
        ],
      }),
      parent: editorContainer,
    });
  } catch {
    editorContainer.style.cssText += `color:${textError};font-size:${fontSizeBase}px;font-family:${fontMono};padding:16px;`;
    editorContainer.textContent = 'Failed to read file';
    registerNode({ id, type: 'viewer', gfx, overlay, width: nodeWidth, height: nodeHeight });
    return;
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

  // Click editor area to focus node
  editorContainer.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    const parent = gfx.parent;
    if (parent) parent.setChildIndex(gfx, parent.children.length - 1);
    blurAllTerminals();
    setActiveNodeId(id);
    overlay.style.zIndex = `${getAllNodes().length + 1}`;
  });

  editorData.set(id, { filePath, fileName, editorView, dirty: false });

  registerNode({
    id,
    type: 'viewer',
    gfx,
    overlay,
    width: nodeWidth,
    height: nodeHeight,
  });
}

export function setActiveEditorNode(id: string): void {
  blurAllTerminals();
  setActiveNodeId(id);
  const entry = getNode(id);
  if (!entry) return;
  entry.overlay.style.zIndex = `${getAllNodes().length + 1}`;
  const parent = entry.gfx.parent;
  if (parent) parent.setChildIndex(entry.gfx, parent.children.length - 1);
}

export function getEditorData(id: string): EditorData | undefined {
  return editorData.get(id);
}

export function isEditorNode(id: string): boolean {
  return editorData.has(id);
}

export function wasRecentlyWritten(filePath: string, windowMs: number = 2000): boolean {
  const ts = recentWrites.get(filePath);
  if (!ts) return false;
  if (Date.now() - ts < windowMs) return true;
  recentWrites.delete(filePath);
  return false;
}

export function destroyEditorNode(id: string) {
  const data = editorData.get(id);
  if (data) {
    data.editorView.destroy();
    editorData.delete(id);
  }
  detachResizeFrame(id);
  const entry = getNode(id);
  if (entry) entry.overlay.remove();
  unregisterNode(id);
}
