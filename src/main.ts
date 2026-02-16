import { Application, FederatedPointerEvent } from 'pixi.js';
import { createCanvas } from './canvas';
import { createNode } from './node';

async function init() {
  const app = new Application();

  await app.init({
    background: '#1a1a2e',
    resizeTo: window,
    antialias: true,
    preference: 'webgl',
  });

  document.body.appendChild(app.canvas);

  const world = createCanvas(app);

  // Spawn initial node at center of world
  createNode(world, 100, 100);

  // Double-click to spawn new nodes
  let lastClickTime = 0;
  app.stage.on('click', (event: FederatedPointerEvent) => {
    const now = performance.now();
    if (now - lastClickTime < 300) {
      const worldX = (event.global.x - world.x) / world.scale.x;
      const worldY = (event.global.y - world.y) / world.scale.y;
      createNode(world, worldX, worldY);
      lastClickTime = 0; // reset to prevent triple-click spawning
    } else {
      lastClickTime = now;
    }
  });
}

init();
