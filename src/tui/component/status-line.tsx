/**
 * One-line footer showing the active model (live, from the SDK), agent
 * status, and a hint for the expand toggle.
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

  return (
    <box flexShrink={0} flexDirection="row" paddingLeft={1} paddingRight={1} backgroundColor={theme.backgroundElement}>
      <text fg={modeColor()}>{modeStr()}</text>
      <text fg={theme.textDim}>{"  "}</text>
      <text fg={statusColor()}>{statusLabel()}</text>
      <box flexGrow={1} />
      <text fg={theme.textMuted}>
        {modelStr() + "  |  " + expandLabel() + "  |  " + tabHint() + "  |  ctrl+k menu"}
      </text>
    </box>
  )
}
