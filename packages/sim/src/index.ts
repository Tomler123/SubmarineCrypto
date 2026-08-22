/**
 * @crush/sim — Monte-Carlo RTP calibration harness (M1.7).
 *
 * Runs the real @crush/engine across behaviour models (instant-cashout,
 * greedy, stop-loss-disciplined, panic) and emits an RTP report artifact.
 * Theta is chosen by this harness, not by intuition (PL-6); the report is the
 * first document a certification lab asks for.
 */

export const SIM_PACKAGE = '@crush/sim';
