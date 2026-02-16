import { Application, Container, FederatedPointerEvent } from 'pixi.js';

export function createCanvas(app: Application) {
  const world = new Container({ isRenderGroup: true });
  app.stage.addChild(world);

  // Make stage interactive for pan events
  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;

  // Update hit area on resize
  window.addEventListener('resize', () => {
    app.stage.hitArea = app.screen;
  });

  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let isSpaceDown = false;

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') isSpaceDown = true;
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') isSpaceDown = false;
  });

  app.stage.on('pointerdown', (event: FederatedPointerEvent) => {
    // Middle mouse or Space+left click
    if (event.button === 1 || (event.button === 0 && isSpaceDown)) {
      isPanning = true;
      panStartX = event.global.x - world.x;
      panStartY = event.global.y - world.y;
      event.stopPropagation();
    }
  });

  app.stage.on('pointermove', (event: FederatedPointerEvent) => {
    if (isPanning) {
      world.x = event.global.x - panStartX;
      world.y = event.global.y - panStartY;
    }
  });

  app.stage.on('pointerup', () => {
    isPanning = false;
  });

  app.stage.on('pointerupoutside', () => {
    isPanning = false;
  });

  return world;
}
