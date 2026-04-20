/**
 * Inline slash-command autocomplete shown above the prompt.
 *
 * Renders only when the prompt value starts with "/". Lists commands
 * whose slash name (or alias) starts with the typed prefix. Caller owns
 * navigation: this component just displays.
 *
 * Selection model: the active index is owned by the parent so navigation
 * keys (intercepted in the prompt's onKeyDown) and the visible state
 * stay in sync. Tab inserts the slash text; Enter pops the palette
 * pre-filtered to the highlighted command.
 */

import { For, Show, createMemo } from "solid-js"
import { useTheme } from "../context/theme.tsx"
import { useCommand, type CommandSpec } from "../context/command.tsx"

export interface AutocompleteEntry {
  spec: CommandSpec
  /** What to insert into the textarea when Tab-completing. */
  insertText: string
  /** Display string for the row. */
  display: string
}

export function buildEntries(spec: CommandSpec): AutocompleteEntry[] {
  if (!spec.slash) return []
  const out: AutocompleteEntry[] = [
    { spec, insertText: "/" + spec.slash.name, display: "/" + spec.slash.name },
  ]
  for (const alias of spec.slash.aliases ?? []) {
    out.push({ spec, insertText: "/" + alias, display: "/" + alias })
  }
  return out
}

export function autocompleteSuggestions(commands: CommandSpec[], inputValue: string): AutocompleteEntry[] {
  if (!inputValue.startsWith("/")) return []
  // Match against the first whitespace-delimited token only — once the
  // user types a space they're typing args, not picking commands.
  const head = inputValue.split(/\s+/, 1)[0] ?? ""
  if (!head.startsWith("/")) return []
  const needle = head.slice(1).toLowerCase()
  const all: AutocompleteEntry[] = commands.flatMap((c) => buildEntries(c))
  if (!needle) return all
  // Prefer prefix matches; fall back to substring.
  const prefix = all.filter((e) => e.display.slice(1).toLowerCase().startsWith(needle))
  if (prefix.length > 0) return prefix
  return all.filter((e) => e.display.slice(1).toLowerCase().includes(needle))
}

// Active-row marker — kept in a const so the column-width math and the
// per-row text both reference the same string.
const MARKER_ACTIVE = "› "
const MARKER_INACTIVE = "  "
// Column width bounds (chars). The row width is computed as
//   clamp(longestEntryLength, MIN, MAX)
// MIN keeps short-only entry sets from squashing the column to nothing
// (so columns still feel like columns, with a stable visual rhythm
// across renders). MAX keeps a single outlier entry — e.g. someone
// adds a 60-char title — from blowing out the row and starving the
// description column.
const CMD_COL_MIN = 12
const CMD_COL_MAX = 24
const TITLE_COL_MIN = 18
const TITLE_COL_MAX = 36
// Spacing between columns. Keeps the cmd, title, and description blocks
// from butting up against each other when content fills the column cap.
const COL_GAP = 2

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(n, hi))
}

export function PromptAutocomplete(props: {
  inputValue: string
  selectedIndex: number
}) {
  const theme = useTheme()
  const command = useCommand()

  const entries = createMemo(() => autocompleteSuggestions(command.visible(), props.inputValue))
  const visible = () => props.inputValue.startsWith("/") && entries().length > 0
  const cappedIndex = createMemo(() => {
    const list = entries()
    if (list.length === 0) return 0
    return Math.max(0, Math.min(props.selectedIndex, list.length - 1))
  })

  // Column widths derived from the longest entry currently displayed,
  // clamped between MIN and MAX. The marker width is always reserved
  // on the cmd column so the cmd text stays in the same column whether
  // the row is highlighted or not.
  const cmdColWidth = createMemo(() => {
    let max = 0
    for (const e of entries()) {
      const len = e.display.length + MARKER_INACTIVE.length
      if (len > max) max = len
    }
    return clamp(max, CMD_COL_MIN, CMD_COL_MAX)
  })
  const titleColWidth = createMemo(() => {
    let max = 0
    for (const e of entries()) {
      const len = e.spec.title.length
      if (len > max) max = len
    }
    return clamp(max, TITLE_COL_MIN, TITLE_COL_MAX)
  })

  return (
    <Show when={visible()}>
      <box
        flexShrink={0}
        flexDirection="column"
        borderColor={theme.border}
        border={["top", "bottom", "left", "right"]}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={theme.backgroundPanel}
      >
        <For each={entries()}>
          {(entry, idx) => {
            const active = createMemo(() => idx() === cappedIndex())
            return (
              <box
                flexDirection="row"
                paddingLeft={1}
                paddingRight={1}
                gap={COL_GAP}
                backgroundColor={active() ? theme.backgroundElement : theme.backgroundPanel}
              >
                {/* Cmd column — fixed width, never wraps. The marker
                    width is reserved on inactive rows too so cmd text
                    stays in the same column. */}
                <box width={cmdColWidth()} flexShrink={0}>
                  <text fg={active() ? theme.primary : theme.text} wrapMode="none">
                    {(active() ? MARKER_ACTIVE : MARKER_INACTIVE) + entry.display}
                  </text>
                </box>
                {/* Title column — fixed width, never wraps. Long titles
                    truncate by clipping; descriptions cover the missing
                    detail. */}
                <box width={titleColWidth()} flexShrink={0}>
                  <text fg={theme.textMuted} wrapMode="none">
                    {entry.spec.title}
                  </text>
                </box>
                {/* Description column — takes remaining row width and
                    wraps. Long descriptions still fit without pushing
                    other columns around because cmd/title are fixed. */}
                <Show when={entry.spec.description}>
                  <box flexGrow={1} flexShrink={1}>
                    <text fg={theme.textDim} wrapMode="word">
                      {entry.spec.description}
                    </text>
                  </box>
                </Show>
              </box>
            )
          }}
        </For>
        <text fg={theme.textDim}>{"  Tab to complete · Enter to open palette · Esc to dismiss"}</text>
      </box>
    </Show>
  )
}
