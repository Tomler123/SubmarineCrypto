import { describe, expect, it, vi } from 'vitest';
import { createCloseCallFeed, renderCloseCallMessage } from '../src/core/close-calls.ts';

function event(overrides = {}){
  return {
    kind: 'close-call',
    closeCall: {
      id: 'close-call:bot-1:625:ascent',
      positionId: 'bot-1',
      dir: 1,
      thresholdBps: 50,
      closest: {
        tick: { t: 250, v: 904.5 },
        crushIndex: 900,
        headroomBps: 50,
      },
      settlement: {
        positionId: 'bot-1',
        reason: 'ascent',
        crushed: false,
        dir: 1,
        stake: 500,
        lev: 10,
        entry: 1000,
        theta: 0.0003,
        tau: 0.5,
        tick: { t: 625, v: 910 },
        multiplier: 0.1,
        ascentCause: 'manual',
        payout: 50,
        pnl: -450,
      },
      ...overrides,
    },
  };
}

describe('CC-5 — Close Call social copy uses emitted facts only', () => {
  it('includes actor, direction, proximity, cause, multiplier, P&L and closest tick', () => {
    const html = renderCloseCallMessage(event(), 'K4raken');
    expect(html).toContain('<b>K4raken</b>');
    expect(html).toContain('SURFACE');
    expect(html).toContain('0.50%');
    expect(html).toContain('MANUAL ASCENT');
    expect(html).toContain('×0.10');
    expect(html).toContain('−$4.50');
    expect(html).toContain('tick 250');
  });

  it('formats Dive and round-end from the authoritative event fields', () => {
    const value = event({
      dir: -1,
      settlement: { ...event().closeCall.settlement, dir: -1, reason: 'round-end', ascentCause: null },
    });
    const html = renderCloseCallMessage(value, 'Baltic_Ann');
    expect(html).toContain('DIVE');
    expect(html).toContain('ROUND END');
  });

  it('escapes the actor label before producing feed HTML', () => {
    expect(renderCloseCallMessage(event(), '<img src=x onerror=alert(1)>')).not.toContain('<img');
  });
});

describe('CC-6/CC-7 — deterministic ordering and duplicate suppression', () => {
  it('renders the first event id and suppresses duplicate delivery', () => {
    const writer = vi.fn();
    const feed = createCloseCallFeed(writer);
    expect(feed.publish(event(), 'K4raken')).toBe(true);
    expect(feed.publish(event(), 'K4raken')).toBe(false);
    expect(writer).toHaveBeenCalledTimes(1);
  });

  it('retains authoritative arrival order for distinct ids', () => {
    const written = [];
    const feed = createCloseCallFeed((html) => written.push(html));
    feed.publish(event({ id: 'second' }), 'Second');
    feed.publish(event({ id: 'first' }), 'First');
    expect(written[0]).toContain('<b>Second</b>');
    expect(written[1]).toContain('<b>First</b>');
  });

  it('wall-clock, timers and DOM contents cannot change projection output', () => {
    const before = renderCloseCallMessage(event(), 'K4raken');
    document.body.innerHTML = '<div data-render-state="different"></div>';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2099-01-01T00:00:00Z'));
    const after = renderCloseCallMessage(event(), 'K4raken');
    vi.useRealTimers();
    expect(after).toBe(before);
  });
});
