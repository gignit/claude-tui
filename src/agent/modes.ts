/**
 * Agent modes we expose in the TUI. These map directly to the SDK's
 * `permissionMode` option (`Options.permissionMode` in
 * @anthropic-ai/claude-agent-sdk's sdk.d.ts).
 *
 *   - Default: tools execute; sensitive ones raise a y/n prompt
 *   - Accept:  file edits are auto-approved; everything else prompts
 *   - Plan:    SDK refuses write/edit/bash tools; Claude presents a plan
 *   - Bypass:  NO permission checks at all (the SDK equivalent of
 *              `claude --dangerously-skip-permissions`)
 *
 * Tab cycles Default → Accept → Plan, mirroring the interactive CLI.
 * Bypass is deliberately NOT in the cycle — it's opt-in via the
 * `--dangerously-skip-permissions` launch flag or the /permissions
 * command, and pressing Tab while in Bypass drops back to Default.
 * The SDK's remaining values (dontAsk, auto) stay unexposed.
 */

import type { Options } from "@anthropic-ai/claude-agent-sdk"

export type SdkPermissionMode = NonNullable<Options["permissionMode"]>

export type AgentMode = "default" | "accept" | "plan" | "bypass"

export const AGENT_MODE_CYCLE: readonly AgentMode[] = ["default", "accept", "plan"]

/** Human-friendly label shown in the status line and per-message stamp. */
export function modeLabel(m: AgentMode): string {
  switch (m) {
    case "plan":
      return "Plan"
    case "accept":
      return "Accept Edits"
    case "bypass":
      return "Bypass Permissions"
    default:
      return "Default"
  }
}

/** Map our friendly label to the SDK's wire value. */
export function modeToSdk(m: AgentMode): SdkPermissionMode {
  switch (m) {
    case "plan":
      return "plan"
    case "accept":
      return "acceptEdits"
    case "bypass":
      return "bypassPermissions"
    default:
      return "default"
  }
}

/** Map an SDK permission mode (from init / setPermissionMode) back to ours. */
export function modeFromSdk(s: SdkPermissionMode | undefined): AgentMode {
  switch (s) {
    case "plan":
      return "plan"
    case "acceptEdits":
      return "accept"
    case "bypassPermissions":
      return "bypass"
    default:
      return "default"
  }
}

/**
 * Parse a user-supplied mode name (CLI flag or /permissions arg) into an
 * SDK permission mode. Accepts our short names and the SDK spellings.
 * Returns undefined for anything unrecognized.
 */
export function parsePermissionMode(raw: string): SdkPermissionMode | undefined {
  switch (raw.trim().toLowerCase()) {
    case "default":
      return "default"
    case "accept":
    case "acceptedits":
    case "accept-edits":
      return "acceptEdits"
    case "plan":
      return "plan"
    case "bypass":
    case "bypasspermissions":
    case "bypass-permissions":
    case "skip":
    case "yolo":
      return "bypassPermissions"
    default:
      return undefined
  }
}

export function nextMode(current: AgentMode): AgentMode {
  // Bypass isn't in the cycle; Tab from Bypass returns to Default so
  // the key always does something predictable.
  const idx = AGENT_MODE_CYCLE.indexOf(current)
  if (idx === -1) return "default"
  return AGENT_MODE_CYCLE[(idx + 1) % AGENT_MODE_CYCLE.length]!
}
