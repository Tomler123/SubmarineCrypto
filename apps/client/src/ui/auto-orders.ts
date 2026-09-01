import { CFG } from '../config/constants.js';
import { S } from '../state/store.js';

/* ================================================================
   AUTO orders (TP/SL) — switch, clamped steppers, bounds mirror.

   The engine owns acceptance. `validateOpenRequest` in @crush/engine
   rejects a take-profit at or below `1 + lev × maxIndexMovePerTick`
   (AO-3: a TP inside one tick's maximum move could trigger on the entry
   tick itself) and a stop-loss outside the open interval (0, 1).

   This module mirrors those bounds for one purpose only: so the − and +
   buttons cannot walk a value out of range, and so a typed value is
   clamped back on blur. It never rejects a submission — `tryOpen` still
   sends whatever is in the field and lets the engine answer, because a
   client mirror may never be stricter than the authority (ADR 0002).

   Both engine bounds are *exclusive*, so the usable grid is one STEP
   inside each: a stepper that could land exactly on the bound would
   offer the player a value the engine refuses.
================================================================ */

const STEP = 0.01;
/** Decimal places implied by STEP — used to kill float drift on each step. */
const DP = 2;

type Field = 'tp' | 'sl';

function round(v: number): number {
  return Number(v.toFixed(DP));
}

/** Smallest take-profit the engine accepts at `lev`, snapped up onto the grid. */
export function tpMin(lev: number): number {
  const exclusive = 1 + lev * CFG.MAX_INDEX_MOVE_PER_TICK;
  const snapped = round(Math.floor(exclusive / STEP) * STEP + STEP);
  // Guard the snap: flooring an exclusive bound that already sits on the grid
  // would return the bound itself, which the engine rejects.
  return snapped <= exclusive ? round(snapped + STEP) : snapped;
}

/** PL-4's max-win multiple is the practical ceiling — past it nothing pays more. */
export function tpMax(): number {
  return CFG.MAX_WIN_MULT;
}

/** Stop-loss lives strictly inside (0, 1); the grid stops one step short. */
export const SL_MIN = STEP;
export const SL_MAX = round(1 - STEP);

export interface Bounds { readonly min: number; readonly max: number }

export function boundsFor(field: Field, lev: number): Bounds {
  return field === 'tp'
    ? { min: tpMin(lev), max: tpMax() }
    : { min: SL_MIN, max: SL_MAX };
}

export function clamp(field: Field, value: number, lev: number): number {
  const { min, max } = boundsFor(field, lev);
  return round(Math.min(max, Math.max(min, value)));
}

export function inRange(field: Field, value: number, lev: number): boolean {
  const { min, max } = boundsFor(field, lev);
  return Number.isFinite(value) && value >= min && value <= max;
}

/** Default seeded when AUTO is switched on: a readable, comfortably legal pair. */
export function defaultFor(field: Field, lev: number): number {
  return field === 'tp' ? clamp('tp', 2, lev) : clamp('sl', 0.5, lev);
}

/**
 * One step from `value`, staying on the grid and inside the bounds.
 * An empty field steps off the default rather than off zero, so the first
 * tap on + lands somewhere sensible instead of at the floor.
 */
export function step(
  field: Field,
  value: number | null,
  dir: 1 | -1,
  lev: number,
): number {
  if (value === null) return defaultFor(field, lev);
  return clamp(field, round(value + dir * STEP), lev);
}

/** Parse a field's raw text. `null` means "empty"; NaN means "not a number". */
export function parseField(raw: string): number | null {
  const t = raw.trim();
  return t === '' ? null : Number(t);
}

/* ---------------- DOM wiring ---------------- */

interface FieldRefs {
  readonly wrap: HTMLElement;
  readonly input: HTMLInputElement;
}

function q<T extends Element>(sel: string): T {
  const n = document.querySelector<T>(sel);
  if (!n) throw new Error(`auto-orders: missing element ${sel}`);
  return n;
}

const row = q<HTMLElement>('#autoRow');
const toggle = q<HTMLButtonElement>('#autoToggle');
const hint = q<HTMLElement>('#autoHint');

const FIELDS: readonly Field[] = ['tp', 'sl'];

const fields: Record<Field, FieldRefs> = {
  tp: {
    wrap: q<HTMLElement>('.autoField[data-field="tp"]'),
    input: q<HTMLInputElement>('#takeProfitIn'),
  },
  sl: {
    wrap: q<HTMLElement>('.autoField[data-field="sl"]'),
    input: q<HTMLInputElement>('#stopLossIn'),
  },
};

/** The switch is the single source of truth for whether TP/SL are sent. */
let enabled = false;

export function autoEnabled(): boolean { return enabled; }

function setHint(text: string, bad = false): void {
  hint.textContent = text;
  hint.classList.toggle('bad', bad && text !== '');
}

/** Refresh the enabled/disabled state of every stepper against current bounds. */
function syncSteppers(): void {
  for (const field of FIELDS) {
    const { min, max } = boundsFor(field, S.lev);
    const value = parseField(fields[field].input.value);
    const at = (edge: number): boolean =>
      value !== null && Number.isFinite(value) && round(value) === edge;
    const down = row.querySelector<HTMLButtonElement>(`[data-step="${field}-down"]`);
    const up = row.querySelector<HTMLButtonElement>(`[data-step="${field}-up"]`);
    if (down) down.disabled = !enabled || at(min);
    if (up) up.disabled = !enabled || at(max);
  }
}

/** Mark a field that currently holds a value the engine would refuse. */
function syncValidity(): void {
  let message = '';
  for (const field of FIELDS) {
    const { input, wrap } = fields[field];
    const value = parseField(input.value);
    const bad = enabled && value !== null && !inRange(field, value, S.lev);
    wrap.classList.toggle('bad', bad);
    if (bad && message === '') {
      const { min, max } = boundsFor(field, S.lev);
      message = `${field.toUpperCase()} MUST BE ${min.toFixed(DP)}×–${max.toFixed(DP)}×`;
    }
  }
  if (message !== '') setHint(message, true);
  else if (hint.classList.contains('bad')) setHint('');
}

function sync(): void {
  syncSteppers();
  syncValidity();
}

function setValue(field: Field, value: number): void {
  fields[field].input.value = value.toFixed(DP);
  sync();
}

/**
 * Re-clamp the take-profit against the current leverage. Its floor is
 * leverage-dependent, so switching 2× → 25× can strand a previously legal TP
 * below the new floor; lifting it is friendlier than letting the engine reject
 * the tap on SURFACE.
 */
export function onLeverageChange(): void {
  if (!enabled) { sync(); return; }
  const value = parseField(fields.tp.input.value);
  if (value !== null && Number.isFinite(value)) {
    const clamped = clamp('tp', value, S.lev);
    if (clamped !== round(value)) {
      setValue('tp', clamped);
      setHint(`TP RAISED TO ${clamped.toFixed(DP)}× FOR ${S.lev}×`);
      return;
    }
  }
  sync();
}

export function setAutoEnabled(next: boolean): void {
  enabled = next;
  row.classList.toggle('off', !enabled);
  toggle.setAttribute('aria-checked', String(enabled));
  for (const field of FIELDS) {
    const { input } = fields[field];
    input.disabled = !enabled;
    if (enabled && parseField(input.value) === null) {
      input.value = defaultFor(field, S.lev).toFixed(DP);
    }
  }
  setHint('');
  sync();
}

toggle.addEventListener('click', () => { setAutoEnabled(!enabled); });

row.addEventListener('click', (ev) => {
  const target = ev.target;
  if (!(target instanceof Element)) return;
  const btn = target.closest<HTMLButtonElement>('[data-step]');
  if (!btn || btn.disabled || !enabled) return;
  const spec = btn.dataset['step'];
  if (spec === undefined) return;
  const [name, dir] = spec.split('-');
  if (name !== 'tp' && name !== 'sl') return;
  const current = parseField(fields[name].input.value);
  const from = current !== null && Number.isFinite(current) ? current : null;
  setValue(name, step(name, from, dir === 'up' ? 1 : -1, S.lev));
  setHint('');
});

for (const field of FIELDS) {
  const { input } = fields[field];
  // Typed input is validated live but clamped only on blur: rewriting the value
  // under the caret makes a number field almost impossible to type into.
  input.addEventListener('input', sync);
  input.addEventListener('blur', () => {
    // `<input type="number">` sanitizes unparseable text to '' on assignment,
    // so the field yields a real number or nothing — never NaN.
    const value = parseField(input.value);
    if (value === null) return;
    const clamped = clamp(field, value, S.lev);
    input.value = clamped.toFixed(DP);
    sync();
    if (clamped !== round(value)) setHint(`${field.toUpperCase()} SET TO ${clamped.toFixed(DP)}×`);
  });
}

setAutoEnabled(false);
