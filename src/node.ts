import { Container, Graphics, FederatedPointerEvent } from 'pixi.js';

export interface NodeState {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const NODE_WIDTH = 400;
const NODE_HEIGHT = 300;
const CORNER_RADIUS = 8;
const FILL_COLOR = '#16213e';
const BORDER_COLOR = '#0f3460';

export function createNode(world: Container, x: number, y: number): NodeState {
  const id = crypto.randomUUID();

  const gfx = new Graphics()
    .roundRect(0, 0, NODE_WIDTH, NODE_HEIGHT, CORNER_RADIUS)
    .fill(FILL_COLOR)
    .stroke({ width: 2, color: BORDER_COLOR });

  gfx.x = x;
  gfx.y = y;
  gfx.eventMode = 'static';
  gfx.cursor = 'pointer';

  let dragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  gfx.on('pointerdown', (event: FederatedPointerEvent) => {
    if (event.button !== 0) return; // left click only

    dragging = true;
    const local = event.getLocalPosition(world);
    dragOffsetX = local.x - gfx.x;
    dragOffsetY = local.y - gfx.y;

    // Bring to front
    world.setChildIndex(gfx, world.children.length - 1);

    event.stopPropagation();
  });

  gfx.on('globalpointermove', (event: FederatedPointerEvent) => {
    if (!dragging) return;
    const local = event.getLocalPosition(world);
    gfx.x = local.x - dragOffsetX;
    gfx.y = local.y - dragOffsetY;
  });

  gfx.on('pointerup', () => {
    dragging = false;
  });

  gfx.on('pointerupoutside', () => {
    dragging = false;
  });

  world.addChild(gfx);

  return { id, x, y, width: NODE_WIDTH, height: NODE_HEIGHT };
}
