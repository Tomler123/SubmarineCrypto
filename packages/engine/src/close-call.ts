/**
 * Authoritative Close Call observation and event construction.
 *
 * This module reads only the position, authoritative tick and the exact crush
 * line implementation used by CR-1/CR-3. It has no clock, scheduler, renderer,
 * DOM or randomness, and it never changes money or settlement decisions.
 */

import { positionCrushIndex } from './position.js';
import type { CloseCall, CloseCallApproach, Position, Settlement, Tick } from './types.js';

/** CC-3: inclusive v1 threshold, versioned by ADR 0008. */
export const CLOSE_CALL_THRESHOLD_BPS = 50;

const BASIS_POINTS_PER_UNIT = 10_000;
const CLOSE_CALL_THRESHOLD_FRACTION = CLOSE_CALL_THRESHOLD_BPS / BASIS_POINTS_PER_UNIT;

/**
 * Observe one surviving post-entry authoritative tick and retain the closest.
 * The caller runs CR-1 first, so every observed headroom is on the survival side.
 */
export function observeCloseCallApproach(
  position: Position,
  tick: Tick,
  tickSeconds: number,
): Position {
  const line = positionCrushIndex(position, tickSeconds);
  const headroomBps = (
    position.dir * (tick.v - line) / line
  ) * BASIS_POINTS_PER_UNIT;
  const withinThreshold = position.dir > 0
    ? tick.v <= line * (1 + CLOSE_CALL_THRESHOLD_FRACTION)
    : tick.v >= line * (1 - CLOSE_CALL_THRESHOLD_FRACTION);
  const candidate: CloseCallApproach = {
    tick,
    crushIndex: line,
    headroomBps,
    withinThreshold,
  };

  // CC-4: strict improvement means an exact tie retains the earliest tick.
  if (
    position.closestApproach !== null
    && position.closestApproach.headroomBps <= candidate.headroomBps
  ) {
    return position;
  }
  return { ...position, closestApproach: candidate };
}

/** Build the one informational event fact for an eligible settlement. */
export function closeCallForSettlement(
  position: Position,
  settlement: Settlement,
): CloseCall | null {
  const closest = position.closestApproach;
  if (
    settlement.crushed
    || settlement.reason === 'crush'
    || settlement.payout <= 0
    || closest === null
    || !closest.withinThreshold
  ) {
    return null;
  }

  return {
    id: `close-call:${settlement.positionId}:${settlement.tick.t}:${settlement.reason}`,
    positionId: settlement.positionId,
    dir: settlement.dir,
    thresholdBps: CLOSE_CALL_THRESHOLD_BPS,
    closest,
    settlement,
  };
}
