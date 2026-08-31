import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ================================================================
   SC-1 / SC-5 / SC-6 — the RendererPort lifecycle.

   PixiJS is mocked at the module boundary, following the rule in
   test/support/mocks.js: a test that reaches into a real WebGL context is
   testing Pixi, not our seam. What we assert here is that the port acquires
   and releases exactly what it claims to, and survives the teardown races a
   real client produces (destroy during a pending init, render after destroy).
================================================================ */

const pixiState = {
  apps: [],
  destroyedApps: 0,
};

vi.mock('pixi.js', () => {
  class FakeContainer {
    constructor(){ this.children = []; this.destroyed = false; this.visible = true; }
    addChild(c){ this.children.push(c); return c; }
    removeChildren(){ this.children.length = 0; }
    destroy(){ this.destroyed = true; }
  }
  class FakeGraphics extends FakeContainer {
    constructor(){ super(); this.ops = []; }
    clear(){ this.ops.push(['clear']); return this; }
    rect(...a){ this.ops.push(['rect', ...a]); return this; }
    circle(...a){ this.ops.push(['circle', ...a]); return this; }
    ellipse(...a){ this.ops.push(['ellipse', ...a]); return this; }
    moveTo(...a){ this.ops.push(['moveTo', ...a]); return this; }
    lineTo(...a){ this.ops.push(['lineTo', ...a]); return this; }
    fill(...a){ this.ops.push(['fill', ...a]); return this; }
    stroke(...a){ this.ops.push(['stroke', ...a]); return this; }
    setStrokeStyle(...a){ this.ops.push(['setStrokeStyle', ...a]); return this; }
  }
  class FakeText extends FakeContainer {
    constructor(opts){ super(); this.text = opts?.text ?? ''; this.style = opts?.style ?? {}; }
  }
  class FakeApplication {
    constructor(){
      this.stage = new FakeContainer();
      // A real element: Pixi hands the host an actual <canvas>, and a plain
      // object would let an appendChild bug pass here and fail in a browser.
      this.canvas = globalThis.document.createElement('canvas');
      this.renderer = {
        resized: [],
        resize(w, h, r){ this.resized.push([w, h, r]); },
        render: vi.fn(),
      };
      this.initCalls = 0;
      this.destroyed = false;
      pixiState.apps.push(this);
    }
    async init(opts){ this.initCalls += 1; this.initOpts = opts; }
    destroy(a, b){ this.destroyed = true; this.destroyArgs = [a, b]; pixiState.destroyedApps += 1; }
  }
  return {
    Application: FakeApplication,
    Container: FakeContainer,
    Graphics: FakeGraphics,
    Text: FakeText,
  };
});

const { createPixiRenderer } = await import('../src/render/pixi-scene.ts');
const { projectScene, DEFAULT_VIEWPORT } = await import('../src/render/scene-model.ts');
const { CFG } = await import('../src/config/constants.js');

function model(overrides = {}){
  return projectScene({
    t: 1000,
    dt: 1 / 60,
    phase: 'running',
    phaseT: 0,
    value: CFG.IDX0,
    position: null,
    lastTick: { t: 900, v: CFG.IDX0 },
    trail: [],
    viewport: { ...DEFAULT_VIEWPORT, width: 390, height: 700 },
    camera: { cam: CFG.BASE_DEPTH, pxm: 0.5 },
    ...overrides,
  });
}

function host(){
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  pixiState.apps.length = 0;
  pixiState.destroyedApps = 0;
  document.body.innerHTML = '';
});

describe('SC-1 — the port satisfies the interface', () => {
  it('exposes init, resize, render and destroy', () => {
    const port = createPixiRenderer();
    for (const m of ['init', 'resize', 'render', 'destroy']){
      expect(port[m]).toBeTypeOf('function');
    }
  });

  it('names itself so the seam can report which renderer is live', () => {
    expect(createPixiRenderer().name).toBe('pixi');
  });
});

describe('SC-5 — init and destroy are symmetric', () => {
  it('creates exactly one application on init', async () => {
    const port = createPixiRenderer();
    await port.init(host(), { width: 390, height: 700 });
    expect(pixiState.apps).toHaveLength(1);
    expect(pixiState.apps[0].initCalls).toBe(1);
  });

  it('is idempotent: a second init does not build a second application', async () => {
    const port = createPixiRenderer();
    const h = host();
    await port.init(h, { width: 390, height: 700 });
    await port.init(h, { width: 390, height: 700 });
    expect(pixiState.apps).toHaveLength(1);
  });

  it('destroys the application and releases the stage', async () => {
    const port = createPixiRenderer();
    await port.init(host(), { width: 390, height: 700 });
    port.destroy();
    expect(pixiState.destroyedApps).toBe(1);
    expect(pixiState.apps[0].destroyed).toBe(true);
  });

  it('removes every listener it registered', async () => {
    const h = host();
    const added = [];
    const removed = [];
    const origAdd = h.addEventListener.bind(h);
    const origRemove = h.removeEventListener.bind(h);
    h.addEventListener = (type, fn, opts) => { added.push(type); origAdd(type, fn, opts); };
    h.removeEventListener = (type, fn, opts) => { removed.push(type); origRemove(type, fn, opts); };
    const port = createPixiRenderer();
    await port.init(h, { width: 390, height: 700 });
    port.destroy();
    expect(removed.slice().sort()).toEqual(added.slice().sort());
  });

  it('is safe to destroy twice', async () => {
    const port = createPixiRenderer();
    await port.init(host(), { width: 390, height: 700 });
    port.destroy();
    expect(() => port.destroy()).not.toThrow();
    expect(pixiState.destroyedApps).toBe(1);
  });

  it('is safe to destroy without ever having been initialised', () => {
    expect(() => createPixiRenderer().destroy()).not.toThrow();
  });

  it('can be re-initialised after destroy', async () => {
    const port = createPixiRenderer();
    await port.init(host(), { width: 390, height: 700 });
    port.destroy();
    await port.init(host(), { width: 390, height: 700 });
    expect(pixiState.apps).toHaveLength(2);
    expect(pixiState.apps[1].destroyed).toBe(false);
  });

  it('render after destroy is a no-op, not a throw', async () => {
    const port = createPixiRenderer();
    await port.init(host(), { width: 390, height: 700 });
    port.destroy();
    expect(() => port.render(model())).not.toThrow();
  });

  it('render before init is a no-op, not a throw', () => {
    expect(() => createPixiRenderer().render(model())).not.toThrow();
  });

  it('a destroy racing a pending init still tears the application down', async () => {
    const port = createPixiRenderer();
    const pending = port.init(host(), { width: 390, height: 700 });
    port.destroy();
    await pending;
    expect(pixiState.apps.every(a => a.destroyed)).toBe(true);
  });
});

describe('SC-6 — resize is data in, no layout read', () => {
  it('forwards width and height to the renderer', async () => {
    const port = createPixiRenderer();
    await port.init(host(), { width: 390, height: 700 });
    port.resize({ width: 500, height: 800, dpr: 2 });
    const resized = pixiState.apps[0].renderer.resized;
    expect(resized.at(-1)[0]).toBe(500);
    expect(resized.at(-1)[1]).toBe(800);
  });

  it('clamps device pixel ratio to the supported ceiling', async () => {
    const port = createPixiRenderer();
    await port.init(host(), { width: 390, height: 700 });
    port.resize({ width: 390, height: 700, dpr: 8 });
    expect(pixiState.apps[0].renderer.resized.at(-1)[2]).toBeLessThanOrEqual(2);
  });

  it('ignores a zero or negative dimension', async () => {
    const port = createPixiRenderer();
    await port.init(host(), { width: 390, height: 700 });
    const before = pixiState.apps[0].renderer.resized.length;
    port.resize({ width: 0, height: 700, dpr: 1 });
    port.resize({ width: 390, height: -1, dpr: 1 });
    expect(pixiState.apps[0].renderer.resized).toHaveLength(before);
  });

  it('resize before init does not throw', () => {
    expect(() => createPixiRenderer().resize({ width: 1, height: 1, dpr: 1 })).not.toThrow();
  });
});

describe('SC-2 — the renderer only ever sees the model', () => {
  it('renders from the model without touching game state', async () => {
    const port = createPixiRenderer();
    await port.init(host(), { width: 390, height: 700 });
    const m = model();
    const snapshot = structuredClone(m);
    port.render(m);
    expect(m).toEqual(snapshot);
  });

  it('draws repeatedly without accumulating display objects', async () => {
    const port = createPixiRenderer();
    await port.init(host(), { width: 390, height: 700 });
    port.render(model());
    const afterFirst = pixiState.apps[0].stage.children.length;
    for (let i = 0; i < 20; i++) port.render(model());
    expect(pixiState.apps[0].stage.children.length).toBe(afterFirst);
  });
});
