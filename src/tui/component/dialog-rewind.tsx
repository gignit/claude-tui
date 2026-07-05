/**
 * Rewind picker (/rewind). Lists the current session's user turns,
 * newest first; picking one restores checkpointed files to that turn
 * (best-effort) and restarts the conversation truncated just before it.
 * The heavy lifting lives in agent.rewindSession().
 */

import { Show, createResource } from "solid-js"
import { useDialog } from "../context/dialog.tsx"
import { useAgent } from "../context/agent.tsx"
import { useTheme } from "../context/theme.tsx"
import { DialogSelect, type DialogSelectOption } from "./dialog-select.tsx"
import { listRewindPoints, type RewindPoint } from "../../util/sessions.ts"

const PREVIEW_MAX = 64

function truncate(s: string, max: number): string {
  const firstLine = s.split("\n", 1)[0] ?? ""
  if (firstLine.length <= max) return firstLine
  return firstLine.slice(0, max - 1) + "…"
}

export function DialogRewindList() {
  const dialog = useDialog()
  const agent = useAgent()
  const theme = useTheme()
  const [points] = createResource(async () => {
    const id = agent.sessionId()
    if (!id) return []
    return listRewindPoints(agent.cwd(), id)
  })

  // Newest last in the file → show newest first; rewinding to a recent
  // turn is the common case.
  const options = (): DialogSelectOption<RewindPoint>[] => {
    const list = points() ?? []
    return [...list].reverse().map((p) => ({
      value: p,
      title: `${p.ordinal + 1}. ${truncate(p.text, PREVIEW_MAX)}`,
      subtitle:
        p.anchorUuid === null
          ? "rewind to the very beginning (fresh session)"
          : "rewind to just before this turn",
    }))
  }

  return (
    <Show when={!points.loading} fallback={<text fg={theme.textMuted}>{"Loading turns…"}</text>}>
      <DialogSelect<RewindPoint>
        title="Rewind to before…"
        placeholder="Type to filter…"
        options={options()}
        emptyMessage="No user turns recorded for this session yet"
        onSelect={async (opt) => {
          dialog.clear()
          await agent.rewindSession(opt.value)
        }}
      />
    </Show>
  )
}
