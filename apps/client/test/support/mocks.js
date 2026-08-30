import { vi } from 'vitest';

/* ================================================================
   MODULE-BOUNDARY MOCKS.

   The rule for this directory: mock at the *module* boundary, never by
   monkey-patching an object the module under test already holds. A seam test
   that reaches through `render/renderer.js` into a canvas context is testing
   the renderer; a seam test that replaces the whole module is testing the
   seam. Only the second survives M1.8 replacing that renderer with PixiJS.

   `installMocks()` must be called before the module under test is imported,
   which is why every test file in here uses dynamic `await import(...)` rather
   than a static top-level import.
================================================================ */

/** Recorded calls, so a test can assert an effect fired without a real canvas. */
export const spies = {
  FX: {},
  Au: {},
  feedMsg: vi.fn(),
  toast: vi.fn(),
  checkLossLimit: vi.fn(),
  pushHistory: vi.fn(),
  showSettleCard: vi.fn(),
  overlayHTML: vi.fn(),
  spawnBots: vi.fn(),
  botsRoundEnd: vi.fn(),
  sourceHalt: vi.fn(),
  sourceResetRound: vi.fn(),
  bufferReset: vi.fn(),
};

const FX_KEYS = [
  'startBlow', 'implode', 'surfaceBurst', 'roundReset', 'entry', 'cash',
];
const AU_KEYS = [
  'click', 'blow', 'implode', 'win', 'ping', 'horn', 'setMuted', 'unlock',
];

export function installMocks(){
  for (const k of FX_KEYS) spies.FX[k] = vi.fn();
  for (const k of AU_KEYS) spies.Au[k] = vi.fn();

  vi.mock('../../src/render/renderer.js', () => ({
    FX: spies.FX,
    trail: [],
    view: { cam: 0, pxm: 0.5, shake: 0, flash: 0, dim: 0, shear: 0 },
    draw: vi.fn(() => ({ v: 1000 })),
    resize: vi.fn(),
    qualityCheck: vi.fn(),
    getLastSubDepth: vi.fn(() => 0),
    getMomentum: vi.fn(() => 0),
    isBreached: vi.fn(() => false),
  }));

  vi.mock('../../src/audio/audio.js', () => ({ Au: spies.Au }));
  vi.mock('../../src/ui/feed.js', () => ({ feedMsg: spies.feedMsg }));
  vi.mock('../../src/ui/overlay.js', () => ({
    toast: spies.toast,
    overlayHTML: spies.overlayHTML,
    showSettleCard: spies.showSettleCard,
  }));
  vi.mock('../../src/ui/responsible.js', () => ({
    checkLossLimit: spies.checkLossLimit,
    refreshLimits: vi.fn(),
    realityCheck: vi.fn(),
  }));
  vi.mock('../../src/ui/history.js', () => ({ pushHistory: spies.pushHistory }));
  vi.mock('../../src/core/bots.js', () => ({
    spawnBots: spies.spawnBots,
    botsRoundEnd: spies.botsRoundEnd,
    botsTick: vi.fn(),
    bots: [],
    BOTNAMES: [],
  }));
  vi.mock('../../src/feed/index.js', () => ({
    source: { halt: spies.sourceHalt, resetRound: spies.sourceResetRound, start: vi.fn(), stop: vi.fn(), onTick: vi.fn() },
    buffer: { reset: spies.bufferReset, push: vi.fn(), valueAt: vi.fn(() => 1000) },
  }));
}

/** Reset every recorded call between tests without rebuilding the mocks. */
export function resetSpies(){
  for (const fn of Object.values(spies.FX)) fn.mockClear();
  for (const fn of Object.values(spies.Au)) fn.mockClear();
  for (const [k, v] of Object.entries(spies)){
    if (typeof v === 'function' && 'mockClear' in v) v.mockClear();
    void k;
  }
}
