/**
 * Reasoning-effort variant picker (/variant). Lists the effort levels
 * the active model supports (from the SDK's ModelInfo), plus a
 * "default" row that clears the override. Mirrors dialog-model.tsx.
 */

import { Show, createResource } from "solid-js"
import { useDialog } from "../context/dialog.tsx"
import { useAgent } from "../context/agent.tsx"
import { useTheme } from "../context/theme.tsx"
import { DialogSelect, type DialogSelectOption } from "./dialog-select.tsx"
import { EFFORT_LEVELS, type EffortLevel, type ModelChoice } from "../../agent/types.ts"

/** Short human blurb per level — mirrors the SDK's EffortLevel jsdoc. */
const LEVEL_HINTS: Record<EffortLevel, string> = {
  low: "Fastest, cheapest responses",
  medium: "Balanced speed and depth",
  high: "More thorough reasoning",
  xhigh: "Very thorough (select models)",
  max: "Maximum effort (select models)",
}

/**
 * Effort levels the given model advertises. Falls back to every level
 * when the model list doesn't include effort metadata (older `claude`
 * binaries) — the runtime silently downgrades unsupported levels, so
 * offering them is safe.
 */
function levelsFor(models: ModelChoice[], activeModel: string | null): readonly EffortLevel[] {
  if (!activeModel) return EFFORT_LEVELS
  const m = models.find((x) => x.id === activeModel || x.resolvedModel === activeModel)
  return m?.supportedEffortLevels && m.supportedEffortLevels.length > 0
    ? m.supportedEffortLevels
    : EFFORT_LEVELS
}

export function DialogVariantList() {
  const dialog = useDialog()
  const agent = useAgent()
  const theme = useTheme()
  const [models] = createResource(() => agent.listModels())

  // "default" sentinel — DialogSelect values must be non-null.
  const options = (): DialogSelectOption<string>[] => {
    const current = agent.effort()
    const rows: DialogSelectOption<string>[] = [
      {
        value: "default",
        title: "default",
        subtitle: "Let the model pick its own effort (no override)",
        ...(current === null ? { hint: "✓ active" } : {}),
      },
    ]
    for (const level of levelsFor(models() ?? [], agent.model())) {
      rows.push({
        value: level,
        title: level,
        subtitle: LEVEL_HINTS[level],
        ...(current === level ? { hint: "✓ active" } : {}),
      })
    }
    return rows
  }

  return (
    <Show
      when={!models.loading}
      fallback={<text fg={theme.textMuted}>{"Loading variants…"}</text>}
    >
      <DialogSelect<string>
        title="Reasoning effort"
        placeholder="Type to filter…"
        options={options()}
        initial={agent.effort() ?? "default"}
        emptyMessage="No variants available"
        onSelect={async (opt) => {
          const next = opt.value === "default" ? null : (opt.value as EffortLevel)
          await agent.setEffort(next)
          agent.pushNotice(`/variant: ${next ?? "default"} (saved)`)
          dialog.clear()
        }}
      />
    </Show>
  )
}
