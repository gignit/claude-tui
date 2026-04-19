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
                backgroundColor={active() ? theme.backgroundElement : theme.backgroundPanel}
              >
                <text fg={active() ? theme.primary : theme.text}>
                  {(active() ? "› " : "  ") + entry.display}
                </text>
                <text fg={theme.textMuted}>{"  " + entry.spec.title}</text>
                <Show when={entry.spec.description}>
                  <box flexGrow={1} />
                  <text fg={theme.textDim}>{entry.spec.description}</text>
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
