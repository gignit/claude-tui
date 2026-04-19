/**
 * Append-only debug log for inspecting TUI behavior from a second terminal.
 *
 * Off by default. When enabled, every interesting event in the system
 * funnels through `dlog(category, payload)` and gets written as a single
 * JSONL line to the configured file.
 *
 * Usage from another terminal:
 *   tail -f /tmp/claude-tui.log
 *
 * The opentui renderer owns the primary terminal, so writing diagnostics
 * to stderr would corrupt the screen. Always use this logger for runtime
 * debugging — never console.log/console.error from inside the TUI.
 */

import { appendFileSync, openSync, closeSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"

interface DebugLogger {
  enabled: boolean
  path: string
  log: (category: string, payload?: unknown) => void
}

let active: DebugLogger = {
  enabled: false,
  path: "",
  log: () => {},
}

export function initDebugLog(path: string | undefined): DebugLogger {
  if (!path) {
    active = { enabled: false, path: "", log: () => {} }
    return active
  }

  // Ensure the parent directory exists, then truncate the file at startup
  // so each run begins clean.
  try {
    mkdirSync(dirname(path), { recursive: true })
    const fd = openSync(path, "w")
    closeSync(fd)
  } catch (err) {
    // Surface to stderr only at startup (before the TUI mounts the screen).
    process.stderr.write(`claude-tui: cannot open debug log at ${path}: ${(err as Error).message}\n`)
    active = { enabled: false, path: "", log: () => {} }
    return active
  }

  const logger: DebugLogger = {
    enabled: true,
    path,
    log: (category, payload) => {
      const entry = {
        t: new Date().toISOString(),
        c: category,
        ...(payload !== undefined ? { d: redact(payload) } : {}),
      }
      try {
        appendFileSync(path, JSON.stringify(entry) + "\n", "utf8")
      } catch {
        // Best-effort. We never want logging to crash the TUI.
      }
    },
  }
  active = logger
  logger.log("logger.init", { path })
  return logger
}

/** Module-level export so call sites don't have to thread the logger around. */
export function dlog(category: string, payload?: unknown): void {
  active.log(category, payload)
}

export function isDebugEnabled(): boolean {
  return active.enabled
}

export function debugLogPath(): string {
  return active.path
}

/**
 * Avoid logging the entire SDK system prompt or huge tool outputs. Strings
 * over 2 KB get summarized; objects are recursively shallowed.
 */
function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === "string") {
    if (value.length > 2048) return value.slice(0, 2048) + `...(+${value.length - 2048} chars)`
    return value
  }
  if (typeof value !== "object") return value
  if (depth > 4) return "[depth-cap]"
  if (Array.isArray(value)) {
    if (value.length > 50) return value.slice(0, 50).map((v) => redact(v, depth + 1)).concat([`...(+${value.length - 50})`])
    return value.map((v) => redact(v, depth + 1))
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as object)) {
    out[k] = redact(v, depth + 1)
  }
  return out
}
