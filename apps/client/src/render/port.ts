import type { SceneModel, Viewport } from './scene-model.ts';

/* ================================================================
   RENDERER PORT — the one interface every renderer implements (SC-1).

   Deliberately the same shape of boundary as `IndexSource` in `@crush/feed`:
   a small lifecycle, data in, nothing out. A renderer is a sink. It is handed
   a `SceneModel` and returns nothing, which is the type-level statement of
   SC-3 — there is no return channel through which a renderer could inform a
   gameplay decision, so "the scene cannot decide anything" is enforced by the
   signature rather than by convention.

   `init` is async because a WebGL context is acquired asynchronously in Pixi
   v8. Canvas 2D resolves immediately; the seam awaits both the same way.
================================================================ */

/** A resize request, in CSS pixels, already measured by the seam (SC-6). */
export interface ResizeRequest {
  readonly width: number;
  readonly height: number;
  /** Device pixel ratio; the port clamps it to the supported ceiling. */
  readonly dpr: number;
}

/**
 * One renderer implementation.
 *
 * Contract, asserted by `renderer-port.test.js`:
 *   - `init` is idempotent per instance and acquires every resource it needs;
 *   - `destroy` releases them all and leaves the port safe to re-`init`;
 *   - `render` and `resize` before `init` or after `destroy` are no-ops, never
 *     throws, so a teardown race cannot crash the client.
 */
export interface RendererPort {
  /** Stable identifier for logging and for the selection seam's report. */
  readonly name: string;
  init(host: HTMLElement, viewport: Viewport): Promise<void>;
  resize(request: ResizeRequest): void;
  render(model: SceneModel): void;
  destroy(): void;
}
