import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CFG } from '../src/config/constants.js';

/* ================================================================
   MATH SHEET — the player-facing copy must describe the engine that is
   actually running.

   This file exists because the sheet went stale once already. It was written
   for the pre-M1.4 engine, and it survived the milestone that added the house
   edge: it kept promising "No house edge is applied in this build" while the
   engine drained 0.25%/s off every open position. Nothing caught it, because
   the sheet is static markup that no module imports and no test read.

   UI-5 requires the sheet to state the formula, θ, the ascent rule and the
   crush rule. That is what is asserted here, against the markup as shipped,
   with θ and the ascent read from CFG rather than hardcoded — so retuning
   θ (M1.7 calibrates it against RTP 96.5%) fails this test until the copy is
   retuned with it. The sheet is the only place a player is told what the house
   takes; wrong copy there is a compliance defect, not a typo.

   Deliberately a text assertion, not a DOM one: the sheet has no behavior to
   exercise, and parsing the file is what lets the test run against the real
   shipped index.html rather than a fixture that can drift from it.
================================================================ */

// Resolved from cwd (the repo root, where vitest.config.ts lives) rather than
// `import.meta.url`: under jsdom the module URL is not a file: URL.
const INDEX_HTML = resolve(process.cwd(), 'apps/client/index.html');

/** The #mathSheet element's inner markup, with entities and tags flattened to text. */
function mathSheetText(){
  const src = readFileSync(INDEX_HTML, 'utf8');
  const start = src.indexOf('<div class="sheet" id="mathSheet">');
  if (start === -1) throw new Error('#mathSheet not found in index.html');
  const end = src.indexOf('\n  </div>', start);
  if (end === -1) throw new Error('#mathSheet is unterminated');
  return src.slice(start, end)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&times;/g, '\u00d7')
    .replace(/&minus;/g, '\u2212')
    .replace(/&Delta;/g, '\u0394')
    .replace(/&mdash;/g, '\u2014')
    .replace(/&middot;/g, '\u00b7')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('#mathSheet describes the M1.4 engine (UI-5)', () => {
  const text = mathSheetText();

  it('parsed the sheet and found real copy', () => {
    // Sanity check on the extractor: if index.html is restructured so the
    // slice comes back empty, fail here rather than vacuously passing the
    // "does not say X" assertions below on an empty string.
    expect(text.length).toBeGreaterThan(400);
    expect(text).toContain('HOW PAYOUTS WORK');
  });

  it('states the oxygen term in the payout formula', () => {
    expect(text).toMatch(/payout = stake .*oxygen/i);
  });

  it('states θ at the rate the engine actually charges', () => {
    // CFG.THETA_PER_S is a per-second fraction; the sheet quotes it as a
    // percent. 0.0025 -> "0.25%".
    const pct = `${+(CFG.THETA_PER_S * 100).toFixed(4)}%`;
    expect(text, `sheet must quote θ as ${pct} per second`).toContain(`${pct} per second`);
    expect(text).toMatch(new RegExp(`${pct.replace('.', '\.')}\s*/\s*s`));
  });

  it('names oxygen as the house edge without softening it', () => {
    expect(text).toMatch(/oxygen is the house edge/i);
    // The exact sentence that went stale through M1.4. Never again.
    expect(text).not.toMatch(/no house edge/i);
    // Deliberately narrow. A broader "no (edge|fee)" ban would fire on the
    // copy that is *correct* — "no spread on entry, no fee on cash-out" is
    // true under §5 and is the sentence that makes the single edge credible.
    // Banning it would push the sheet toward vaguer, worse disclosure.
    expect(text).not.toMatch(/no (house )?edge is applied/i);
  });

  it('states the crush rule, including that the line creeps', () => {
    expect(text).toMatch(/crush line/i);
    expect(text).toMatch(/creep/i);
    expect(text).toMatch(/1 \/ leverage/i);
    // The worked example: 10× on an entry of 1000 starts at 900 and creeps.
    expect(text).toContain('900');
    expect(text).toContain('915');
    expect(text).toMatch(/capped at (your|the) stake/i);
  });

  it('states the ascent rule at the duration the engine uses', () => {
    const seconds = CFG.ASCENT_MS / 1000;
    expect(text, `sheet must quote the ascent as ${seconds}s`).toContain(`${seconds}s`);
    expect(text).toMatch(/blow ballast|ascen/i);
    expect(text).toMatch(/crushed mid-escape/i);
  });
});
