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

  // Smooth zoom with lerping
  const MIN_SCALE = 0.1;
  const MAX_SCALE = 5.0;
  const ZOOM_LERP = 0.15; // Smoothing factor (0-1, lower = smoother)

  let targetScale = 1.0;
  let targetX = world.x;
  let targetY = world.y;
  // Cursor position for zoom anchoring
  let zoomCursorX = 0;
  let zoomCursorY = 0;

  app.canvas.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();

    const rect = app.canvas.getBoundingClientRect();
    zoomCursorX = e.clientX - rect.left;
    zoomCursorY = e.clientY - rect.top;

    // Gentler zoom factor for trackpad
    const factor = e.deltaY > 0 ? 0.97 : 1.03;
    targetScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, targetScale * factor));
  }, { passive: false });

  // Animation loop for smooth zoom
  app.ticker.add(() => {
    const currentScale = world.scale.x;
    const scaleDiff = Math.abs(targetScale - currentScale);

    if (scaleDiff < 0.0001) return; // Close enough, skip

    // World position under cursor before zoom
    const worldBeforeX = (zoomCursorX - world.x) / world.scale.x;
    const worldBeforeY = (zoomCursorY - world.y) / world.scale.y;

    // Lerp toward target scale
    const newScale = currentScale + (targetScale - currentScale) * ZOOM_LERP;
    world.scale.set(newScale);

    // World position under cursor after zoom
    const worldAfterX = (zoomCursorX - world.x) / world.scale.x;
    const worldAfterY = (zoomCursorY - world.y) / world.scale.y;

    // Correct position so cursor stays over same world point
    world.x += (worldAfterX - worldBeforeX) * world.scale.x;
    world.y += (worldAfterY - worldBeforeY) * world.scale.y;
  });

  // Prevent browser context menu on canvas
  app.canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  return world;
}
