import { describe, expect, it } from 'vitest';
import { Application, Container, Graphics, Text } from 'pixi.js';

/* ================================================================
   The real PixiJS v8 API surface `pixi-scene.ts` depends on.

   Every other renderer test mocks `pixi.js` at the module boundary, which is
   the right call for testing our seam — but it means a Pixi upgrade that
   renamed or re-signatured a method would leave those tests green and break
   the actual scene. This file is the counterweight: it runs against the real
   library and asserts only the calls the port makes, with the argument shapes
   it makes them with.

   It deliberately does not render: acquiring a WebGL context needs a real
   browser, which the jsdom suite does not have. Rendering correctness is what
   the retained Canvas renderer is diffed against by eye.
================================================================ */

describe('PixiJS v8 — the API surface the scene port depends on', () => {
  it('Graphics exposes every method pixi-scene uses', () => {
    const g = new Graphics();
    for (const m of ['clear','rect','circle','ellipse','moveTo','lineTo','fill','stroke']){
      expect(typeof g[m], m).toBe('function');
    }
  });
  it('Graphics calls chain and accept our argument shapes', () => {
    const g = new Graphics();
    expect(() => g.clear().rect(0,0,10,10).fill(0x112233)).not.toThrow();
    expect(() => g.moveTo(0,0).lineTo(5,5).stroke({ color: 0xFFB454, width: 1.8, alpha: 0.8 })).not.toThrow();
    expect(() => g.ellipse(0,0,34,12.5).fill(0x16262D)).not.toThrow();
    expect(() => g.circle(1,1,2.6).fill(0xFFE2AA)).not.toThrow();
    expect(() => g.rect(0,0,5,5).fill({ color: 0xEAF4F1, alpha: 0.7 })).not.toThrow();
    expect(() => g.ellipse(0,0,6.5,9).fill(0x101E24).stroke({ color: 0x4CF2C0, width: 1.4 })).not.toThrow();
  });
  it('Container add/remove works as the port assumes', () => {
    const c = new Container();
    const child = c.addChild(new Graphics());
    expect(child).toBeInstanceOf(Graphics);
    expect(() => c.removeChildren()).not.toThrow();
  });
  it('Text accepts the options object and a settable style fill', () => {
    const t = new Text({ text: 'ENTRY 1000.0', style: { fontFamily: 'IBM Plex Mono, monospace', fontSize: 10 } });
    expect(t.text).toBe('ENTRY 1000.0');
    expect(() => { t.style.fill = 0xFFB454; }).not.toThrow();
    expect(() => { t.visible = false; t.x = 8; t.y = 20; }).not.toThrow();
  });
  it('Application exposes init and destroy', () => {
    const app = new Application();
    expect(typeof app.init).toBe('function');
    expect(typeof app.destroy).toBe('function');
  });
});
