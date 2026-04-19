/**
 * Scroll-acceleration shim for the message-log scrollbox.
 *
 * opentui's scrollbox calls `tick()` once per scroll-wheel event and
 * advances by the returned number of lines. The simplest "constant
 * speed" implementation just returns the configured number — this
 * matches the behaviour everyone expects from a vt100-ish terminal
 * scroll wheel.
 *
 * Out of the box opentui scrolls one line per tick, which feels
 * sluggish on long transcripts. We default to 3 lines/tick which is
 * the same speed common terminal apps tend to settle on.
 *
 * Future direction: the user can opt into opentui's `MacOSScrollAccel`
 * for momentum/inertial scrolling. Not wired yet — when needed, gate
 * it behind another setting (`scrollAcceleration: true`) and return
 * `new MacOSScrollAccel()` here instead.
 */

import type { ScrollAcceleration } from "@opentui/core"

/** Sensible default. Range we accept is 1..MAX_SCROLL_SPEED. */
export const DEFAULT_SCROLL_SPEED = 3
export const MIN_SCROLL_SPEED = 1
export const MAX_SCROLL_SPEED = 20

export function clampScrollSpeed(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SCROLL_SPEED
  return Math.max(MIN_SCROLL_SPEED, Math.min(MAX_SCROLL_SPEED, Math.round(n)))
}

/** Build the constant-speed acceleration object passed to <scrollbox>. */
export function createScrollAccel(speed: number): ScrollAcceleration {
  const lines = clampScrollSpeed(speed)
  return {
    tick: () => lines,
    reset: () => {},
  }
}
