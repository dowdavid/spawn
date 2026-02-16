import { Application } from 'pixi.js';
import { createCanvas } from './canvas';

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
}

init();
