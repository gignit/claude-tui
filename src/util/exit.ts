/**
 * Clean shutdown of the TUI. Calls opentui's `renderer.destroy()` to
 * restore terminal state (alt-screen out, mouse mode off, cursor restored)
 * before terminating the process. Without this, the user's terminal is
 * left in raw mode and looks broken until they `reset`.
 *
 * After destroy we also write `\x1b[2J\x1b[H` so any leftover paint from
 * the alt-screen restore is wiped before the shell prompt returns.
 */

import type { CliRenderer } from "@opentui/core"

let exiting = false

export function exitTui(renderer: CliRenderer | undefined, code: number = 0): void {
  if (exiting) return
  exiting = true
  try {
    renderer?.setTerminalTitle?.("")
  } catch {
    // ignore
  }
  try {
    renderer?.destroy?.()
  } catch {
    // ignore — we're going down anyway
  }
  // After destroy, write a final clear so any leftover paint from the
  // alt-screen restore is wiped. \x1b[2J = clear, \x1b[H = home cursor.
  try {
    if (process.stdout.isTTY) process.stdout.write("\x1b[2J\x1b[H")
  } catch {
    // ignore
  }
  process.exit(code)
}
