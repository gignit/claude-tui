/**
 * Model picker. Pulls the live model list from the agent, renders each
 * one in the shared DialogSelect primitive, marks the currently active
 * one with a hint, and persists the selection on pick.
 */

import { Show, createResource } from "solid-js"
import { useDialog } from "../context/dialog.tsx"
import { useAgent } from "../context/agent.tsx"
import { useTheme } from "../context/theme.tsx"
import { DialogSelect, type DialogSelectOption } from "./dialog-select.tsx"

export function DialogModelList() {
  const dialog = useDialog()
  const agent = useAgent()
  const theme = useTheme()
  const [models] = createResource(() => agent.listModels())

  const options = (): DialogSelectOption<string>[] => {
    const list = models() ?? []
    const current = agent.model() ?? ""
    return list.map((m) => ({
      value: m.id,
      title: m.displayName || m.id,
      ...(m.description ? { subtitle: m.description } : {}),
      // Right-aligned hint: only mark the currently active row. Showing
      // the model id for every row clutters the panel and most ids are
      // long enough to wrap awkwardly.
      ...(m.id === current ? { hint: "✓ active" } : {}),
    }))
  }

  return (
    <Show
      when={!models.loading}
      fallback={<text fg={theme.textMuted}>{"Loading models…"}</text>}
    >
      <DialogSelect<string>
        title="Switch model"
        placeholder="Type to filter…"
        options={options()}
        initial={agent.model() ?? undefined}
        emptyMessage="No models reported by the SDK"
        onSelect={async (opt) => {
          await agent.setModel(opt.value)
          dialog.clear()
        }}
      />
    </Show>
  )
}
