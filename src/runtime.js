import { isSharedGeometry } from './parts.js';

export const tickers = new Set();
export const flickerLights = [];
export const clothPieces = [];

export function onTick(fn) {
  tickers.add(fn);
  return fn;
}

export function clearRuntime() {
  tickers.clear();
  flickerLights.length = 0;
  clothPieces.length = 0;
}

export function disposeTree(root) {
  root.traverse((obj) => {
    // Cached primitives outlive the build; disposing them would force a
    // re-upload on the next rebuild for no benefit.
    if (obj.geometry && !isSharedGeometry(obj.geometry)) obj.geometry.dispose();
    if (obj.isInstancedMesh) obj.dispose();
  });
}

/** Frame-rate independent smoothing helper. */
export function damp(current, target, lambda, dt) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}
