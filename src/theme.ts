// Centralized design tokens — single source of truth for all visual constants.
// Node dimensions stay in node.ts (layout/behavior, not visual design).

import type { NodeType } from './state';

// ===== PALETTE =====

// Canvas & surfaces
export const canvasBg = '#1a1a2e';
export const nodeBg = '#16213e';
export const titleBarBg = '#0f2040';

// Borders
export const borderDefault = '#0f3460';
export const borderWidth = 2;
export const cornerRadius = 8;

// Per-node-type accent colors (borders, nodules, hover states)
export const accent: Record<NodeType, string> = {
  terminal: '#e94560',
  project: '#a78bfa',
  viewer: '#34d399',
  browser: '#f59e0b',
};

// Text hierarchy
export const textPrimary = '#c0c8d0';
export const textSecondary = '#8899aa';
export const textTertiary = '#6a7a8a';
export const textMuted = '#4a5568';
export const textDimmed = '#3a4a5a';
export const textBody = '#e0e0e0';
export const textError = '#e94560';

// Inputs
export const inputBg = '#0a1628';
export const inputBorder = '#1a3a5c';
export const inputText = '#e0e8f0';

// Interactive surfaces
export const hoverBg = '#1a2a40';
export const scrollbarThumb = '#2a3a4a';

// Connections
export const connectionStroke = '#4a9eff';
export const connectionOpacity = 0.6;

// Folders
export const folderIcon = '#7a8a9a';
export const chevronIcon = '#6a7a8a';

// ===== TYPOGRAPHY =====

export const fontMono = "Menlo,Monaco,'Courier New',monospace";
export const fontSizeBase = 14;
export const fontSizeCode = 15;
export const fontSizeSmall = 13;
export const fontSizeXSmall = 12;

// ===== SPACING =====

export const titleBarPadding = '0 10px';
export const titleBarGap = 6;
export const contentPadding = 16;
export const treePaddingY = 8;
export const treeRowPaddingX = 10;
export const treeIndent = 20;
export const treeBaseIndent = 14;

// ===== SIZING =====

export const iconSize = 16;
export const noduleSize = 14;
export const closeBtnPadding = 2;
export const smallRadius = 4;
export const buttonRadius = 6;

// ===== SHADOWS & EFFECTS =====

export const noduleGlow = (color: string) => `0 0 6px ${color}88`;
export const noduleGlowPulse = (color: string) => `0 0 12px ${color}cc`;
export const highlightGlow = (color: string) => `0 0 15px ${color}88`;

// ===== TERMINAL =====

export const terminalPadding = '8px 0px 14px 14px';
export const cursorColor = '#e94560';
export const selectionBg = '#0f346080';
