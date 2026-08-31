import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { installDom } from './support/dom.js';

// The seam imports the Canvas renderer, which — like every UI module in this
// client — resolves its DOM nodes at module load. Install the skeleton before
// any dynamic import below, per the convention in support/dom.js.
installDom();

/* ================================================================
   SC-1 — renderer selection stays inside the render seam.

   Deliberately the same shape as `feed-selection.test.js`. The feed seam
   earned that test by being the boundary Phase 2 swaps an implementation
   through; the renderer boundary has exactly the same job for M1.8 and the
   Pixi/Canvas swap, so it gets the same guard rather than a weaker one.
================================================================ */

const CLIENT_SRC = resolve(process.cwd(), 'apps/client/src');
const RENDER_DIR = resolve(process.cwd(), 'apps/client/src/render');
const RENDER_INDEX = join(RENDER_DIR, 'index.js');

function sourceFiles(directory){
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return (full.endsWith('.js') || full.endsWith('.ts')) ? [full] : [];
  });
}

vi.mock('pixi.js', () => {
  class Stub {
    constructor(){ this.children = []; this.stage = new Stub0(); }
  }
  class Stub0 {
    constructor(){ this.children = []; }
    addChild(c){ this.children.push(c); return c; }
    removeChildren(){ this.children.length = 0; }
    destroy(){}
  }
  class FakeApplication {
    constructor(){
      this.stage = new Stub0();
      this.canvas = {};
      this.renderer = { resize(){}, render(){} };
    }
    async init(){}
    destroy(){}
  }
  return {
    Application: FakeApplication,
    Container: Stub0,
    Graphics: class extends Stub0 {
      clear(){ return this; } rect(){ return this; } circle(){ return this; }
      ellipse(){ return this; } moveTo(){ return this; } lineTo(){ return this; }
      fill(){ return this; } stroke(){ return this; } setStrokeStyle(){ return this; }
    },
    Text: class extends Stub0 { constructor(o){ super(); this.text = o?.text ?? ''; } },
    Stub,
  };
});

describe('SC-1 — the Canvas renderer remains the default', () => {
  it('selects the Canvas 2D renderer when nothing is requested', async () => {
    const { selectRendererName } = await import('../src/render/index.js');
    expect(selectRendererName('')).toBe('canvas');
  });

  it('selects Canvas for an unrecognised value rather than failing over', async () => {
    const { selectRendererName } = await import('../src/render/index.js');
    expect(selectRendererName('?renderer=webgpu')).toBe('canvas');
    expect(selectRendererName('?renderer=')).toBe('canvas');
  });

  it('selects PixiJS only through the explicit ?renderer=pixi opt-in', async () => {
    const { selectRendererName } = await import('../src/render/index.js');
    expect(selectRendererName('?renderer=pixi')).toBe('pixi');
  });

  it('keeps the opt-in working alongside the feed opt-in', async () => {
    const { selectRendererName } = await import('../src/render/index.js');
    expect(selectRendererName('?feed=replay&renderer=pixi')).toBe('pixi');
  });

  it('builds a port that satisfies the interface for either selection', async () => {
    const { createRenderer } = await import('../src/render/index.js');
    for (const search of ['', '?renderer=pixi']){
      const port = createRenderer(search);
      for (const m of ['init', 'resize', 'render', 'destroy']){
        expect(port[m]).toBeTypeOf('function');
      }
    }
  });
});

describe('SC-1 — no module outside render/ knows which renderer is running', () => {
  it('does not leak a concrete renderer name into the rest of the client', () => {
    for (const file of sourceFiles(CLIENT_SRC)){
      if (file.startsWith(RENDER_DIR)) continue;
      const text = readFileSync(file, 'utf8');
      expect(text).not.toContain('createPixiRenderer');
      expect(text).not.toContain('pixi.js');
    }
  });

  it('names both implementations inside the seam itself', () => {
    const seam = readFileSync(RENDER_INDEX, 'utf8');
    expect(seam).toContain('createPixiRenderer');
    expect(seam).toContain('canvas');
  });
});
