/**
 * Tiny JSON-on-disk state store. One global file at
 * $XDG_CONFIG_HOME/claude-tui/state.json (defaulting to
 * ~/.config/claude-tui/state.json).
 *
 * Failure to read/write is non-fatal: the TUI keeps running with an empty
 * state and surfaces a system notice so the user knows persistence is off.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"

export interface PersistedState {
  /** Last selected model id. Undefined → use whatever `claude` defaults to. */
  model?: string
  /** Mouse-wheel scroll speed in lines per tick (1..20). Default 3. */
  scrollSpeed?: number
  /**
   * Whether to render assistant messages through opentui's markdown
   * renderer (headings, lists, tables, code, links). Disable to fall back
   * to plain text. Default true.
   */
  markdown?: boolean
  /**
   * When markdown rendering is enabled, controls whether the renderer
   * runs while text is still streaming (true → live re-parse on every
   * chunk) or waits until the assistant message completes before
   * formatting it (false → plain text shown during streaming, then
   * swapped to formatted markdown on completion). Default true.
   *
   * Set to false if streaming markdown re-renders feel laggy or if the
   * incremental parser produces visual flicker on your terminal.
   */
  markdownStreaming?: boolean
}

export function statePath(): string {
  const xdg = process.env["XDG_CONFIG_HOME"]
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config")
  return join(base, "claude-tui", "state.json")
}

export function loadState(): PersistedState {
  const path = statePath()
  try {
    const raw = readFileSync(path, "utf8")
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object") return parsed as PersistedState
    return {}
  } catch (err: any) {
    if (err?.code === "ENOENT") return {}
    // Malformed JSON or perm error — start fresh, don't crash.
    return {}
  }
}

export function saveState(patch: Partial<PersistedState>): void {
  const path = statePath()
  const current = loadState()
  const next: PersistedState = { ...current, ...patch }
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(next, null, 2) + "\n", "utf8")
  } catch {
    // Swallow — caller cannot do anything useful with this failure here.
  }
}
