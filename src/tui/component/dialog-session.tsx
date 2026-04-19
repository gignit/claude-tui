/**
 * Session picker. Lists conversations stored on disk for the current
 * project's cwd and lets the user resume one.
 *
 * The actual switch (tear down current Query, spawn a new one with
 * `resume: <id>`, replay history into the store) is owned by the
 * AgentProvider — we just call agent.resumeSession(id) and clear.
 */

import { Show, createResource } from "solid-js"
import { useDialog } from "../context/dialog.tsx"
import { useAgent } from "../context/agent.tsx"
import { useTheme } from "../context/theme.tsx"
import { DialogSelect, type DialogSelectOption } from "./dialog-select.tsx"
import { listSessions, type SessionSummary } from "../../util/sessions.ts"

// Max characters for the preview line shown as the row title. The dialog
// box is ~80 wide minus 8 chars of padding/indentation, so 64 keeps the
// title safely on one line in any terminal that fits the dialog at all.
const PREVIEW_MAX = 64

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + "…"
}

export function DialogSessionList() {
  const dialog = useDialog()
  const agent = useAgent()
  const theme = useTheme()
  const [sessions] = createResource(() => listSessions(agent.cwd()))

  const options = (): DialogSelectOption<string>[] => {
    const list: SessionSummary[] = sessions() ?? []
    return list.map((s) => ({
      value: s.id,
      // Previews are first-user-message text and frequently very long.
      // Hard-truncate so each row stays exactly one line.
      title: truncate(s.preview || "(no preview)", PREVIEW_MAX),
      subtitle: shortId(s.id) + (s.firstAt ? "  " + relativeTime(s.firstAt) : ""),
      hint: s.id === agent.sessionId() ? "active" : "",
    }))
  }

  return (
    <Show when={!sessions.loading} fallback={<text fg={theme.textMuted}>{"Loading sessions…"}</text>}>
      <DialogSelect<string>
        title={`Sessions in ${agent.cwd()}`}
        placeholder="Type to filter…"
        options={options()}
        emptyMessage="No prior sessions found for this project"
        onSelect={async (opt) => {
          dialog.clear()
          await agent.resumeSession(opt.value)
        }}
      />
    </Show>
  )
}

function shortId(uuid: string): string {
  return uuid.slice(0, 8)
}

function relativeTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ""
  const diffMs = Date.now() - t
  const sec = Math.round(diffMs / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  return `${day}d ago`
}
