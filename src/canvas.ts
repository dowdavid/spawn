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

  // Zoom
  const MIN_SCALE = 0.1;
  const MAX_SCALE = 5.0;

  app.canvas.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();

    const rect = app.canvas.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;

    // World position under cursor before zoom
    const worldBeforeX = (cursorX - world.x) / world.scale.x;
    const worldBeforeY = (cursorY - world.y) / world.scale.y;

    // Adjust scale
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, world.scale.x * factor));
    world.scale.set(newScale);

    // World position under cursor after zoom
    const worldAfterX = (cursorX - world.x) / world.scale.x;
    const worldAfterY = (cursorY - world.y) / world.scale.y;

    // Correct position so cursor stays over same world point
    world.x += (worldAfterX - worldBeforeX) * world.scale.x;
    world.y += (worldAfterY - worldBeforeY) * world.scale.y;
  }, { passive: false });

  return world;
}
