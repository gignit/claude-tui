/**
 * Two ORTHOGONAL pieces of agent state that the SDK unfortunately
 * flattens into one wire enum (`Options.permissionMode`):
 *
 *   AgentMode — what Claude is doing. Default (execute) or Plan
 *     (read-only, presents a plan). Toggled with Tab, and by Claude
 *     itself via the plan_enter / plan_exit tools.
 *
 *   PermissionLevel — how much gets prompted. Set ONLY by explicit
 *     user action (/permissions or a launch flag), never by Tab:
 *       - default: sensitive tools raise a y/n prompt
 *       - accept:  file edits auto-approved; everything else prompts
 *       - bypass:  no permission checks at all (the SDK equivalent of
 *                  `claude --dangerously-skip-permissions`)
 *
 * The wire value is derived: plan mode always sends "plan"; otherwise
 * the level maps to default / acceptEdits / bypassPermissions. When
 * plan mode exits, the level is re-applied — so a user-set level
 * survives any number of Tab presses and plan round-trips.
 * The SDK's remaining values (dontAsk, auto) stay unexposed.
 */

import type { Options } from "@anthropic-ai/claude-agent-sdk"

export type SdkPermissionMode = NonNullable<Options["permissionMode"]>

export type AgentMode = "default" | "plan"

export type PermissionLevel = "default" | "accept" | "bypass"

/** Human-friendly mode label for the status line and per-message stamp. */
export function modeLabel(m: AgentMode): string {
  return m === "plan" ? "Plan" : "Default"
}

/** Human-friendly permission-level label. */
export function levelLabel(l: PermissionLevel): string {
  switch (l) {
    case "accept":
      return "Accept Edits"
    case "bypass":
      return "Bypass Permissions"
    default:
      return "Default (prompts)"
  }
}

/** Map an SDK permission mode back to the mode axis. */
export function modeFromSdk(s: SdkPermissionMode | undefined): AgentMode {
  return s === "plan" ? "plan" : "default"
}

/**
 * Map an SDK permission mode back to the level axis. "plan" carries no
 * level information — callers should keep their previous level.
 */
export function levelFromSdk(s: SdkPermissionMode | undefined): PermissionLevel {
  switch (s) {
    case "acceptEdits":
      return "accept"
    case "bypassPermissions":
      return "bypass"
    default:
      return "default"
  }
}

export function levelToSdk(l: PermissionLevel): SdkPermissionMode {
  switch (l) {
    case "accept":
      return "acceptEdits"
    case "bypass":
      return "bypassPermissions"
    default:
      return "default"
  }
}

/** The single wire value the SDK understands, derived from both axes. */
export function effectiveSdkMode(mode: AgentMode, level: PermissionLevel): SdkPermissionMode {
  return mode === "plan" ? "plan" : levelToSdk(level)
}

/**
 * Parse a user-supplied level name (CLI flag or /permissions arg).
 * Accepts our short names and the SDK spellings. Returns undefined for
 * anything unrecognized — including "plan", which is a MODE (Tab), not
 * a permission level.
 */
export function parsePermissionLevel(raw: string): PermissionLevel | undefined {
  switch (raw.trim().toLowerCase()) {
    case "default":
      return "default"
    case "accept":
    case "acceptedits":
    case "accept-edits":
      return "accept"
    case "bypass":
    case "bypasspermissions":
    case "bypass-permissions":
    case "skip":
    case "yolo":
      return "bypass"
    default:
      return undefined
  }
}

export function nextMode(current: AgentMode): AgentMode {
  return current === "plan" ? "default" : "plan"
}
