/**
 * One-line footer showing mode, agent status, context-window usage,
 * and the active model + key hints.
 */

import { useTheme } from "../context/theme.tsx"
import { useAgent } from "../context/agent.tsx"
import { useExpand } from "../context/expand.tsx"
import { modeLabel, nextMode } from "../../agent/modes.ts"

export function StatusLine() {
  const theme = useTheme()
  const agent = useAgent()
  const expand = useExpand()

  const statusLabel = () => {
    const s = agent.status()
    switch (s.kind) {
      case "idle":
        return "ready"
      case "thinking":
        return "thinking..."
      case "streaming":
        return "responding..."
      case "tool_running":
        return `running ${s.toolName}...`
      case "error":
        return `error: ${s.message}`
    }
  }

  const statusColor = () => {
    const s = agent.status()
    if (s.kind === "error") return theme.error
    if (s.kind === "idle") return theme.success
    return theme.accent
  }

  const modelStr = () => agent.model() ?? "connecting..."
  const modeStr = () => modeLabel(agent.mode())
  // Plan mode is a meaningful behavior change — color it distinctly so
  // the user can't miss when they're in it.
  const modeColor = () => (agent.mode() === "plan" ? theme.warn : theme.accent)
  // Show the *target* of pressing Tab so the action is obvious without
  // requiring the user to remember which mode they're currently in.
  const tabHint = () => `tab > ${modeLabel(nextMode(agent.mode())).toLowerCase()}`
  const expandLabel = () => (expand.expanded() ? "expanded (ctrl+o)" : "collapsed (ctrl+o)")

  /** "21k / 1M (2%)" or null if we don't have a number yet. */
  const contextLabel = (): string | null => {
    const u = agent.contextUsage()
    if (!u) return null
    return `ctx ${humanTokens(u.totalTokens)}/${humanTokens(u.maxTokens)} (${Math.round(u.percentage)}%)`
  }
  // Color the context segment by how full the window is. Cheap visual
  // warning before the user runs out of room.
  const contextColor = () => {
    const u = agent.contextUsage()
    if (!u) return theme.textMuted
    if (u.percentage >= 90) return theme.error
    if (u.percentage >= 70) return theme.warn
    return theme.textMuted
  }

  return (
    <box flexShrink={0} flexDirection="row" paddingLeft={1} paddingRight={1} backgroundColor={theme.backgroundElement}>
      <text fg={modeColor()}>{modeStr()}</text>
      <text fg={theme.textDim}>{"  "}</text>
      <text fg={statusColor()}>{statusLabel()}</text>
      <text fg={theme.textDim}>{"  "}</text>
      <text fg={contextColor()}>{contextLabel() ?? ""}</text>
      <box flexGrow={1} />
      <text fg={theme.textMuted}>
        {modelStr() + "  |  " + expandLabel() + "  |  " + tabHint() + "  |  ctrl+k menu"}
      </text>
    </box>
  )
}

/**
 * Format a token count like "21k", "1.4M", "847". Keeps the status
 * line compact regardless of context size.
 */
function humanTokens(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    return m >= 10 ? `${Math.round(m)}M` : `${m.toFixed(1).replace(/\.0$/, "")}M`
  }
  if (n >= 1_000) {
    const k = n / 1_000
    return k >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1).replace(/\.0$/, "")}k`
  }
  return String(Math.round(n))
}
