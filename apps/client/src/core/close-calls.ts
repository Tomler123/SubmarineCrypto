import type { CloseCallEvent } from '@crush/engine';
import { fmt$ } from '../util/format.js';
import { feedMsg } from '../ui/feed.js';

type FeedWriter = (html: string, you?: boolean) => void;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

function settlementLabel(event: CloseCallEvent): string {
  const settlement = event.closeCall.settlement;
  if (settlement.reason === 'round-end') return 'ROUND END';
  const cause = settlement.ascentCause ?? 'manual';
  return `${cause.replace('-', ' ').toUpperCase()} ASCENT`;
}

/** Format only authority-emitted facts; no outcome or proximity rule lives here. */
export function renderCloseCallMessage(event: CloseCallEvent, actor: string): string {
  const fact = event.closeCall;
  const settlement = fact.settlement;
  const direction = fact.dir > 0 ? 'SURFACE' : 'DIVE';
  const directionClass = fact.dir > 0 ? 'up' : 'dn';
  const pnlClass = settlement.pnl >= 0 ? 'win' : 'lose';
  const pnlPrefix = settlement.pnl >= 0 ? '+' : '';
  const proximity = (fact.closest.headroomBps / 100).toFixed(2);

  return `<b>${escapeHtml(actor)}</b> escaped <span class="close-call">${proximity}%</span> from crush · `
    + `<span class="${directionClass}">${direction}</span> · ${settlementLabel(event)} · `
    + `×${settlement.multiplier.toFixed(2)} · <span class="${pnlClass}">${pnlPrefix}${fmt$(settlement.pnl)}</span> · `
    + `tick ${fact.closest.tick.t}`;
}

/** One ordered, idempotent projection of authoritative Close Call events. */
export function createCloseCallFeed(write: FeedWriter) {
  const seen = new Set<string>();
  return Object.freeze({
    publish(event: CloseCallEvent, actor: string, you = false): boolean {
      const id = event.closeCall.id;
      if (seen.has(id)) return false;
      seen.add(id);
      write(renderCloseCallMessage(event, actor), you);
      return true;
    },
  });
}

/** Shared session projector, so player and fake-actor duplicates share one id set. */
export const closeCallFeed = createCloseCallFeed(feedMsg);
