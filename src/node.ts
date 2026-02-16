import { Container, Graphics } from 'pixi.js';

export const NODE_WIDTH = 720;
export const NODE_HEIGHT = 480;
export const TITLE_BAR_HEIGHT = 30;

export const PROJECT_WIDTH = 400;
export const PROJECT_HEIGHT = 600;

export const VIEWER_WIDTH = 600;
export const VIEWER_HEIGHT = 500;

export interface NodeHandle {
  id: string;
  gfx: Graphics;
}

export function createNode(world: Container, x: number, y: number): NodeHandle {
  const id = crypto.randomUUID();

  // Invisible graphics — just a position anchor for the HTML overlay
  const gfx = new Graphics();
  gfx.x = x;
  gfx.y = y;
  gfx.alpha = 0;

  world.addChild(gfx);

  return { id, gfx };
}
