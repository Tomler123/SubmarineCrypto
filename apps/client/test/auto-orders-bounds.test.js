import { beforeEach, describe, expect, it } from 'vitest';
import { installDom } from './support/dom.js';
import { installMocks } from './support/mocks.js';

installDom();
installMocks();

const auto = await import('../src/ui/auto-orders.ts');
const { S } = await import('../src/state/store.js');
const { CFG } = await import('../src/config/constants.js');

const {
  boundsFor, clamp, inRange, step, tpMin, tpMax, SL_MIN, SL_MAX,
  setAutoEnabled, autoEnabled,
} = auto;

const tpInput = document.querySelector('#takeProfitIn');
const slInput = document.querySelector('#stopLossIn');
const toggle = document.querySelector('#autoToggle');
const hint = document.querySelector('#autoHint');
const tpUp = document.querySelector('[data-step="tp-up"]');
const tpDown = document.querySelector('[data-step="tp-down"]');
const slUp = document.querySelector('[data-step="sl-up"]');
const slDown = document.querySelector('[data-step="sl-down"]');

/** The engine's own AO-3 rule, restated so the mirror is checked against it. */
const engineTpFloor = (lev) => 1 + lev * CFG.MAX_INDEX_MOVE_PER_TICK;

beforeEach(() => {
  S.lev = 10;
  tpInput.value = '';
  slInput.value = '';
  setAutoEnabled(false);
});

describe('AO-3 bounds mirror', () => {
  it.each(CFG.LEV)('puts the TP floor strictly above the engine bound at %i×', (lev) => {
    expect(tpMin(lev)).toBeGreaterThan(engineTpFloor(lev));
  });

  it.each(CFG.LEV)('keeps the TP floor within one step of the engine bound at %i×', (lev) => {
    // A floor that clears the bound by a wide margin would silently deny the
    // player legal values, so the mirror is checked for tightness too.
    expect(tpMin(lev)).toBeLessThanOrEqual(engineTpFloor(lev) + 0.02);
  });

  it('raises the TP floor as leverage rises', () => {
    const floors = CFG.LEV.map((lev) => tpMin(lev));
    expect(floors).toEqual([...floors].sort((a, b) => a - b));
    expect(new Set(floors).size).toBe(floors.length);
  });

  it('caps TP at the PL-4 max-win multiple', () => {
    expect(tpMax()).toBe(CFG.MAX_WIN_MULT);
  });

  it('keeps SL strictly inside the engine open interval (0, 1)', () => {
    expect(SL_MIN).toBeGreaterThan(0);
    expect(SL_MAX).toBeLessThan(1);
  });
});

describe('clamping', () => {
  it('lifts a too-small TP to the floor for the current leverage', () => {
    expect(clamp('tp', 1.01, 25)).toBe(tpMin(25));
  });

  it('lowers a too-large TP to the max-win multiple', () => {
    expect(clamp('tp', 999, 10)).toBe(CFG.MAX_WIN_MULT);
  });

  it('pulls SL back inside (0, 1) from either side', () => {
    expect(clamp('sl', 0, 10)).toBe(SL_MIN);
    expect(clamp('sl', -5, 10)).toBe(SL_MIN);
    expect(clamp('sl', 1, 10)).toBe(SL_MAX);
    expect(clamp('sl', 7.5, 10)).toBe(SL_MAX);
  });

  it('leaves an already-legal value untouched', () => {
    expect(clamp('tp', 2.5, 10)).toBe(2.5);
    expect(clamp('sl', 0.8, 10)).toBe(0.8);
  });

  it('agrees with inRange at both edges', () => {
    for (const field of ['tp', 'sl']) {
      const { min, max } = boundsFor(field, S.lev);
      expect(inRange(field, min, S.lev)).toBe(true);
      expect(inRange(field, max, S.lev)).toBe(true);
      expect(inRange(field, Number((min - 0.01).toFixed(2)), S.lev)).toBe(false);
      expect(inRange(field, Number((max + 0.01).toFixed(2)), S.lev)).toBe(false);
    }
  });
});

describe('stepping', () => {
  it('never leaves the bounds however many times it is pressed', () => {
    for (const field of ['tp', 'sl']) {
      const { min, max } = boundsFor(field, S.lev);
      let down = max;
      let up = min;
      for (let i = 0; i < 8000; i += 1) {
        down = step(field, down, -1, S.lev);
        up = step(field, up, 1, S.lev);
        expect(inRange(field, down, S.lev)).toBe(true);
        expect(inRange(field, up, S.lev)).toBe(true);
      }
      expect(down).toBe(min);
      expect(up).toBe(max);
    }
  });

  it('stays on the 0.01 grid instead of accumulating float drift', () => {
    let v = step('sl', null, 1, S.lev);
    for (let i = 0; i < 40; i += 1) v = step('sl', v, 1, S.lev);
    expect(v).toBe(Number(v.toFixed(2)));
  });

  it('starts from a sensible default when the field is empty', () => {
    expect(step('tp', null, 1, S.lev)).toBe(clamp('tp', 2, S.lev));
    expect(step('sl', null, -1, S.lev)).toBe(clamp('sl', 0.5, S.lev));
  });
});

describe('the AUTO switch', () => {
  it('starts off, with the fields disabled and the row marked off', () => {
    expect(autoEnabled()).toBe(false);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(tpInput.disabled).toBe(true);
    expect(slInput.disabled).toBe(true);
    expect(document.querySelector('#autoRow').classList.contains('off')).toBe(true);
  });

  it('enables the fields and seeds legal defaults when switched on', () => {
    toggle.dispatchEvent(new window.Event('click', { bubbles: true }));

    expect(autoEnabled()).toBe(true);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(tpInput.disabled).toBe(false);
    expect(inRange('tp', Number(tpInput.value), S.lev)).toBe(true);
    expect(inRange('sl', Number(slInput.value), S.lev)).toBe(true);
  });

  it('keeps every stepper disabled while it is off', () => {
    for (const btn of [tpUp, tpDown, slUp, slDown]) expect(btn.disabled).toBe(true);
  });
});

describe('stepper buttons', () => {
  beforeEach(() => { setAutoEnabled(true); });

  it('moves the field by one step and writes it back at 2dp', () => {
    tpInput.value = '2.00';
    tpUp.dispatchEvent(new window.Event('click', { bubbles: true }));
    expect(tpInput.value).toBe('2.01');

    tpDown.dispatchEvent(new window.Event('click', { bubbles: true }));
    expect(tpInput.value).toBe('2.00');
  });

  it('disables the down button exactly at the floor and the up button at the ceiling', () => {
    tpInput.value = tpMin(S.lev).toFixed(2);
    tpInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(tpDown.disabled).toBe(true);
    expect(tpUp.disabled).toBe(false);

    tpInput.value = CFG.MAX_WIN_MULT.toFixed(2);
    tpInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(tpUp.disabled).toBe(true);
    expect(tpDown.disabled).toBe(false);
  });

  it('cannot be walked out of range at the SL edges', () => {
    slInput.value = SL_MAX.toFixed(2);
    slInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(slUp.disabled).toBe(true);

    slInput.value = SL_MIN.toFixed(2);
    slInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(slDown.disabled).toBe(true);
  });
});

describe('typed input', () => {
  beforeEach(() => { setAutoEnabled(true); });

  it('flags an out-of-range value while typing without rewriting it', () => {
    tpInput.value = '1.02';
    tpInput.dispatchEvent(new window.Event('input', { bubbles: true }));

    expect(tpInput.value).toBe('1.02');
    expect(document.querySelector('.autoField[data-field="tp"]').classList.contains('bad')).toBe(true);
    expect(hint.textContent).toContain('TP MUST BE');
  });

  it('clamps on blur and clears the warning', () => {
    tpInput.value = '1.02';
    tpInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    tpInput.dispatchEvent(new window.Event('blur', { bubbles: true }));

    expect(Number(tpInput.value)).toBe(tpMin(S.lev));
    expect(document.querySelector('.autoField[data-field="tp"]').classList.contains('bad')).toBe(false);
  });

  it('leaves an empty field empty on blur so AUTO can be half-configured', () => {
    tpInput.value = '';
    tpInput.dispatchEvent(new window.Event('blur', { bubbles: true }));
    expect(tpInput.value).toBe('');
  });

  it('never yields a NaN value, because a number field blanks unparseable text', () => {
    // `<input type="number">` sanitizes on assignment: garbage becomes '', which
    // the parser reports as "empty" rather than NaN. This is why the submitted
    // value is either a real number or `undefined` and never NaN.
    slInput.value = 'abc';
    expect(slInput.value).toBe('');

    slInput.dispatchEvent(new window.Event('blur', { bubbles: true }));
    expect(slInput.value).toBe('');
    expect(auto.parseField(slInput.value)).toBe(null);
  });
});

describe('leverage changes', () => {
  it('raises a TP that the new leverage would put below the floor', () => {
    S.lev = 2;
    setAutoEnabled(true);
    tpInput.value = '1.05';
    tpInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(inRange('tp', 1.05, 2)).toBe(true);

    S.lev = 25;
    auto.onLeverageChange();

    expect(Number(tpInput.value)).toBe(tpMin(25));
    expect(hint.textContent).toContain('TP RAISED');
  });

  it('leaves a TP that is still legal at the new leverage alone', () => {
    S.lev = 25;
    setAutoEnabled(true);
    tpInput.value = '5.00';
    tpInput.dispatchEvent(new window.Event('input', { bubbles: true }));

    S.lev = 2;
    auto.onLeverageChange();

    expect(tpInput.value).toBe('5.00');
  });
});
