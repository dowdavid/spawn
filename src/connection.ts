import type { Container } from 'pixi.js';
import { getAllConnections, getNode } from './state';

let svgLayer: SVGSVGElement;

export function initConnectionLayer(): SVGSVGElement {
  svgLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgLayer.style.cssText =
    'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;';
  document.body.appendChild(svgLayer);
  return svgLayer;
}

export function createConnectionPath(): SVGPathElement {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#4a9eff');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-opacity', '0.6');
  svgLayer.appendChild(path);
  return path;
}

export function syncConnections(world: Container) {
  const scale = world.scale.x;
  const worldX = world.x;
  const worldY = world.y;

  for (const conn of getAllConnections()) {
    const source = getNode(conn.sourceId);
    const target = getNode(conn.targetId);

    if (!source || !target) {
      if (conn.element) conn.element.setAttribute('d', '');
      continue;
    }

    // Ensure SVG path element exists
    if (!conn.element) {
      conn.element = createConnectionPath();
    }

    // Screen positions of node centers
    const sx = source.gfx.x * scale + worldX + (source.width * scale) / 2;
    const sy = source.gfx.y * scale + worldY + (source.height * scale) / 2;
    const tx = target.gfx.x * scale + worldX + (target.width * scale) / 2;
    const ty = target.gfx.y * scale + worldY + (target.height * scale) / 2;

    // Find edge anchor points
    const [x1, y1] = getEdgePoint(
      source.gfx.x * scale + worldX,
      source.gfx.y * scale + worldY,
      source.width * scale,
      source.height * scale,
      tx, ty,
    );
    const [x2, y2] = getEdgePoint(
      target.gfx.x * scale + worldX,
      target.gfx.y * scale + worldY,
      target.width * scale,
      target.height * scale,
      sx, sy,
    );

    // Bezier control points
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const curvature = Math.min(dist * 0.3, 80 * scale);

    const cx1 = x1 + (dx > 0 ? curvature : -curvature);
    const cy1 = y1;
    const cx2 = x2 - (dx > 0 ? curvature : -curvature);
    const cy2 = y2;

    conn.element.setAttribute(
      'd',
      `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`,
    );
  }
}

function getEdgePoint(
  nodeX: number,
  nodeY: number,
  nodeW: number,
  nodeH: number,
  targetX: number,
  targetY: number,
): [number, number] {
  const cx = nodeX + nodeW / 2;
  const cy = nodeY + nodeH / 2;
  const dx = targetX - cx;
  const dy = targetY - cy;

  if (dx === 0 && dy === 0) return [cx, cy];

  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const halfW = nodeW / 2;
  const halfH = nodeH / 2;

  if (absDx * halfH > absDy * halfW) {
    // Hits left or right edge
    const sign = dx > 0 ? 1 : -1;
    return [cx + sign * halfW, cy + (dy * halfW) / absDx];
  } else {
    // Hits top or bottom edge
    const sign = dy > 0 ? 1 : -1;
    return [cx + (dx * halfH) / absDy, cy + sign * halfH];
  }
}
