/**
 * @crush/gateway — the request/ack seam.
 *
 * Every player action (open, cash-out, auto-order set) is a request. Today it
 * resolves locally behind a fake latency; in M2.2 the same call sites await
 * real server acks. Populated by moving apps/client/src/core/gateway.js here
 * once M1.3 has given it a pure engine to call.
 */

export const GATEWAY_PACKAGE = '@crush/gateway';
