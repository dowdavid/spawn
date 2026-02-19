import { Container, Graphics } from 'pixi.js';

export const NODE_WIDTH = 720;
export const NODE_HEIGHT = 480;
export const TITLE_BAR_HEIGHT = 30;

export const PROJECT_WIDTH = 400;
export const PROJECT_HEIGHT = 600;

export const VIEWER_WIDTH = 600;
export const VIEWER_HEIGHT = 500;

export const BROWSER_WIDTH = 800;
export const BROWSER_HEIGHT = 600;

export const MIN_NODE_WIDTH = 400;
export const MIN_NODE_HEIGHT = 200;
export const MIN_PROJECT_WIDTH = 250;
export const MIN_PROJECT_HEIGHT = 200;
export const MIN_VIEWER_WIDTH = 300;
export const MIN_VIEWER_HEIGHT = 200;
export const MIN_BROWSER_WIDTH = 400;
export const MIN_BROWSER_HEIGHT = 300;

export interface NodeHandle {
  id: string;
  gfx: Graphics;
}

export function createNode(world: Container, x: number, y: number): NodeHandle {
  const id = crypto.randomUUID();
  return createNodeWithId(world, x, y, id);
}

export function createNodeWithId(world: Container, x: number, y: number, id: string): NodeHandle {
  // Invisible graphics — just a position anchor for the HTML overlay
  const gfx = new Graphics();
  gfx.x = x;
  gfx.y = y;
  gfx.alpha = 0;

  world.addChild(gfx);

  return { id, gfx };
}
