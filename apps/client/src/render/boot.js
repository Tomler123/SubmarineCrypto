import { $ } from '../util/dom.js';
import { MAX_DPR } from './scene-model.ts';
import { initScene, renderer, resizeScene } from './index.js';

/* ================================================================
   SCENE BOOT — the one place that reads layout (SC-6).

   A renderer must never measure the page itself: two renderers measuring
   independently is two sources of truth for one number, and a renderer that
   reads the DOM is a renderer that cannot run headless in a test. So the
   measurement happens here, once, and is handed to the port as data.

   The Canvas renderer still carries its own `window` resize listener from the
   prototype, because it is retained verbatim as the visual reference. That
   means Canvas resizes twice — once via its own listener and once through the
   port — which is idempotent and harmless. It stops being true when Canvas is
   retired.
================================================================ */

/** Current device pixel ratio, clamped to what a renderer will allocate. */
function currentDpr(){
  return Math.min(globalThis.devicePixelRatio || 1, MAX_DPR);
}

/** Measure the scene host in CSS pixels. */
function measure(host){
  return { width: host?.clientWidth ?? 0, height: host?.clientHeight ?? 0 };
}

/**
 * Start the live renderer and keep it sized to its host.
 *
 * Returns the boot promise so a caller can await a WebGL context if it needs
 * to; the client does not, because the first frame is scheduled by rAF and a
 * port renders nothing before `init` resolves (SC-5).
 */
export function bootScene(){
  const host = $('#sceneWrap');
  const { width, height } = measure(host);

  // Both scenes live in the same wrapper. Whichever renderer is not selected
  // must not paint over the other, so the prototype's canvas is hidden when
  // the Pixi port takes the host. Hiding rather than removing keeps the
  // Canvas renderer's module-load node lookup valid — it is still the visual
  // reference and must stay constructible.
  const legacyCanvas = $('#scene');
  if (legacyCanvas) legacyCanvas.style.display = renderer.name === 'canvas' ? '' : 'none';

  globalThis.addEventListener('resize', () => {
    const next = measure(host);
    resizeScene(next.width, next.height, currentDpr());
  });

  return initScene(host, width, height, currentDpr());
}

/** Tear the live renderer down. Exposed for tests and future hot-reload. */
export function shutdownScene(){
  renderer.destroy();
}
