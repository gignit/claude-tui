/**
 * Agent modes we expose in the TUI. These map directly to the SDK's
 * `permissionMode` option — see `Options.permissionMode` in
 * @anthropic-ai/claude-agent-sdk's sdk.d.ts:1415.
 *
 * We intentionally surface only Default and Plan because they are the two
 * conceptually-distinct modes:
 *   - Default: tools execute (with permission prompts for sensitive ones)
 *   - Plan:    SDK refuses to execute write/edit/bash-modifying tools;
 *              Claude reads code and presents a plan instead.
 *
 * The other PermissionMode values (acceptEdits, bypassPermissions,
 * dontAsk, auto) are permission-handling tweaks rather than separate
 * "modes" — exposing them in the cycle would just confuse users.
 */

import type { Options } from "@anthropic-ai/claude-agent-sdk"

export type SdkPermissionMode = NonNullable<Options["permissionMode"]>

export type AgentMode = "default" | "plan"

export const AGENT_MODE_CYCLE: readonly AgentMode[] = ["default", "plan"]

/** Human-friendly label shown in the status line and per-message stamp. */
export function modeLabel(m: AgentMode): string {
  return m === "plan" ? "Plan" : "Default"
}

/** Map our friendly label to the SDK's wire value. */
export function modeToSdk(m: AgentMode): SdkPermissionMode {
  return m === "plan" ? "plan" : "default"
}

/** Map an SDK permission mode (from init / setPermissionMode) back to ours. */
export function modeFromSdk(s: SdkPermissionMode | undefined): AgentMode {
  return s === "plan" ? "plan" : "default"
}

export function nextMode(current: AgentMode): AgentMode {
  const idx = AGENT_MODE_CYCLE.indexOf(current)
  return AGENT_MODE_CYCLE[(idx + 1) % AGENT_MODE_CYCLE.length]!
}
