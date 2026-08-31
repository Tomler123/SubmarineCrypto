import { Application, Container, Graphics, Text } from 'pixi.js';
import { MAX_DPR } from './scene-model.ts';
import type { SceneModel, Viewport } from './scene-model.ts';
import type { RendererPort, ResizeRequest } from './port.ts';

/* ================================================================
   PIXI SCENE — the PixiJS v8 RendererPort (M1.8).

   This file is a *consumer* of `SceneModel` and nothing else. It has no
   import of `S`, `Engine`, `buffer`, `CFG` or the DOM beyond the host element
   it is handed, which is the structural half of SC-2/SC-3: there is no path
   from here back into a gameplay decision, because there is nothing here to
   reach it with.

   Scope note (M1.8, approved): this ports the **gameplay-critical** layers —
   the depth-lit water column, the wake that *is* the chart, the sub, the pod,
   and the entry/crush lines UI-4 requires. The purely decorative layers of the
   Canvas scene (creatures, god rays, marine snow, sonar sweep, murk, debris)
   are deliberately not ported yet: they carry no information a player acts on,
   and the Canvas renderer is retained as the visual reference until parity has
   been reviewed by eye. Adding them later touches this file only.

   Display objects are allocated once in `init` and mutated in `render`. Pixi
   v8's `Graphics` is retained-mode, so redrawing means `clear()` then
   re-issuing the path — not allocating a new object per frame, which is what
   `renderer-port.test.js` pins with its "no accumulating children" case.
================================================================ */

/** Pack an [r,g,b] triple into the 0xRRGGBB integer Pixi expects. */
function packColor(c: readonly number[]): number {
  const r = Math.max(0, Math.min(255, Math.round(c[0] ?? 0)));
  const g = Math.max(0, Math.min(255, Math.round(c[1] ?? 0)));
  const b = Math.max(0, Math.min(255, Math.round(c[2] ?? 0)));
  return (r << 16) | (g << 8) | b;
}

/** The layers of the scene, back to front. */
interface Layers {
  readonly water: Graphics;
  readonly wake: Graphics;
  readonly lines: Graphics;
  readonly sub: Graphics;
  readonly pod: Graphics;
  readonly entryLabel: Text;
  readonly crushLabel: Text;
  readonly vignette: Graphics;
}

const LABEL_STYLE = { fontFamily: 'IBM Plex Mono, monospace', fontSize: 10 };

/**
 * Create a PixiJS renderer port.
 *
 * Nothing happens until `init`; the returned object is inert and safe to
 * `destroy` or `render` before then (SC-5).
 */
export function createPixiRenderer(): RendererPort {
  let app: Application | null = null;
  let layers: Layers | null = null;
  let destroyed = false;
  /**
   * Set as soon as `destroy` is called, even if an `init` is still in flight.
   * Without it, a teardown racing a pending init would leave an orphaned
   * application holding a WebGL context — the leak SC-5's race case exists to
   * catch.
   */
  let disposeRequested = false;
  /*
   * The port keeps no reference to its host and registers **no** listeners of
   * its own: resize is measured by `render/boot.js` and delivered as data
   * (SC-6), and Pixi's own `destroy(true, …)` detaches the canvas it created.
   * There is therefore nothing to unwind on teardown beyond the application
   * itself. `renderer-port.test.js` asserts that balance by recording every
   * add/remove on the host element.
   */

  function buildLayers(stage: Container): Layers {
    const water = stage.addChild(new Graphics());
    const wake = stage.addChild(new Graphics());
    const lines = stage.addChild(new Graphics());
    const sub = stage.addChild(new Graphics());
    const pod = stage.addChild(new Graphics());
    const entryLabel = stage.addChild(new Text({ text: '', style: LABEL_STYLE }));
    const crushLabel = stage.addChild(new Text({ text: '', style: LABEL_STYLE }));
    const vignette = stage.addChild(new Graphics());
    return { water, wake, lines, sub, pod, entryLabel, crushLabel, vignette };
  }

  function drawWater(g: Graphics, model: SceneModel): void {
    const { width, height } = model.viewport;
    g.clear();
    // A banded approximation of the Canvas linear gradient: Pixi v8 has no
    // native gradient fill on Graphics, and bands are cheaper than a shader
    // for a colour ramp this smooth.
    const BANDS = 8;
    for (let i = 0; i < BANDS; i++){
      const f = i / (BANDS - 1);
      const c = [0, 1, 2].map(k =>
        (model.water.topColor[k] ?? 0) +
        ((model.water.bottomColor[k] ?? 0) - (model.water.topColor[k] ?? 0)) * f);
      g.rect(0, (height / BANDS) * i, width, height / BANDS + 1).fill(packColor(c));
    }
    if (model.surfaceY > -40 && model.surfaceY < height + 40){
      g.rect(0, model.surfaceY - 1, width, 2).fill({ color: 0xEAF4F1, alpha: 0.7 });
    }
  }

  function drawWake(g: Graphics, model: SceneModel): void {
    g.clear();
    if (model.wake.length < 2) return;
    const first = model.wake[0];
    if (!first) return;
    g.moveTo(first.x, first.y);
    for (const p of model.wake) g.lineTo(p.x, p.y);
    g.lineTo(model.sub.x, model.sub.y);
    g.stroke({ color: 0xFFB454, width: 1.8, alpha: 0.8 });
  }

  function drawLines(g: Graphics, model: SceneModel, labels: Layers): void {
    g.clear();
    const pos = model.position;
    if (!pos){
      labels.entryLabel.visible = false;
      labels.crushLabel.visible = false;
      return;
    }
    const { width } = model.viewport;
    g.moveTo(0, pos.entryY).lineTo(width, pos.entryY)
      .stroke({ color: 0xFFB454, width: 1, alpha: 0.6 });
    g.moveTo(0, pos.crushY).lineTo(width, pos.crushY)
      .stroke({ color: 0xFF4B33, width: 1, alpha: 0.75 });

    labels.entryLabel.visible = true;
    labels.crushLabel.visible = true;
    labels.entryLabel.text = `ENTRY ${pos.entryIndex.toFixed(1)}`;
    labels.crushLabel.text = `CRUSH ${pos.crushIndex.toFixed(1)}`;
    labels.entryLabel.x = 8;
    labels.entryLabel.y = pos.entryY - 14;
    labels.crushLabel.x = 8;
    labels.crushLabel.y = pos.crushY - 14;
    labels.entryLabel.style.fill = 0xFFB454;
    labels.crushLabel.style.fill = 0xFF4B33;
  }

  function drawSub(g: Graphics, model: SceneModel): void {
    g.clear();
    const { x, y } = model.sub;
    g.ellipse(x, y, 34, 12.5).fill(0x16262D);
    g.moveTo(x - 8, y - 11).lineTo(x - 5, y - 19)
      .lineTo(x + 7, y - 19).lineTo(x + 10, y - 11).fill(0x1B2C33);
    g.circle(x + 31, y, 2.6).fill(0xFFE2AA);
  }

  function drawPod(g: Graphics, model: SceneModel): void {
    g.clear();
    const pos = model.position;
    if (!pos) return;
    const color = pos.dir > 0 ? 0x4CF2C0 : 0x9FC4D8;
    const x = model.sub.x + 3;
    const y = model.sub.y + 15;
    g.ellipse(x, y, 6.5, 9).fill(0x101E24).stroke({ color, width: 1.4 });
    g.circle(x, y - 2, 2).fill(color);
  }

  function drawVignette(g: Graphics, model: SceneModel): void {
    const { width, height } = model.viewport;
    g.clear();
    if (model.tension > 0.08){
      g.rect(0, 0, width, height)
        .fill({ color: 0xFF4B33, alpha: model.tension * 0.18 });
    }
  }

  return {
    name: 'pixi',

    async init(hostEl: HTMLElement, viewport: Viewport): Promise<void> {
      // Idempotent per instance (SC-5): a live application means there is
      // nothing to rebuild. After `destroy` there is none, so a re-init builds
      // a fresh one.
      if (app) return;
      destroyed = false;
      disposeRequested = false;

      const created = new Application();
      await created.init({
        width: Math.max(1, viewport.width),
        height: Math.max(1, viewport.height),
        resolution: Math.min(viewport.dpr || 1, MAX_DPR),
        antialias: true,
        background: 0x01060A,
        autoDensity: true,
        autoStart: false,
      });

      // A destroy that arrived while `init` was awaiting must still win, or the
      // context created above would outlive the port that owns it.
      if (disposeRequested){
        created.destroy(true, { children: true });
        return;
      }

      app = created;
      layers = buildLayers(created.stage);
      if (created.canvas && hostEl.appendChild) hostEl.appendChild(created.canvas as Node);
    },

    resize(request: ResizeRequest): void {
      if (!app || destroyed) return;
      if (!(request.width > 0) || !(request.height > 0)) return;
      const dpr = Math.min(Math.max(request.dpr || 1, 1), MAX_DPR);
      app.renderer.resize(request.width, request.height, dpr);
    },

    render(model: SceneModel): void {
      if (!app || !layers || destroyed) return;
      drawWater(layers.water, model);
      drawWake(layers.wake, model);
      drawLines(layers.lines, model, layers);
      drawSub(layers.sub, model);
      drawPod(layers.pod, model);
      drawVignette(layers.vignette, model);
      app.renderer.render(app.stage);
    },

    destroy(): void {
      disposeRequested = true;
      if (destroyed) return;
      destroyed = true;
      if (app){
        // `destroy(true, …)` removes the canvas from the DOM as well, so the
        // host is left exactly as the port found it.
        app.destroy(true, { children: true });
        app = null;
      }
      layers = null;
    },
  };
}
