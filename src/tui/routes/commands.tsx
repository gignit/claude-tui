/**
 * Built-in commands registered for the chat route.
 *
 * Adding a new command:
 *   1. Add a CommandSpec to the array returned by `registerBuiltinCommands`.
 *   2. Give it a `slash: { name: "..." }` if you want it accessible via /name.
 *   3. The `onSelect` runs when the user picks it (palette, slash command,
 *      or programmatic trigger).
 *   4. To open another dialog from a command, call `dialog.replace(() => <YourDialog />)`.
 *
 * Sessions live in their own dialog file (dialog-session.tsx) and are
 * registered the same way — keeps each feature contained.
 */

import type { JSX } from "solid-js"
import { useCommand, type CommandSpec } from "../context/command.tsx"
import { useDialog, type DialogContext } from "../context/dialog.tsx"
import { useAgent } from "../context/agent.tsx"
import { useSettings } from "../context/settings.tsx"
import { DialogModelList } from "../component/dialog-model.tsx"
import { DialogSessionList } from "../component/dialog-session.tsx"
import { MAX_SCROLL_SPEED, MIN_SCROLL_SPEED } from "../../util/scroll.ts"

interface BuiltinDeps {
  command: ReturnType<typeof useCommand>
  dialog: DialogContext
  agent: ReturnType<typeof useAgent>
  settings: ReturnType<typeof useSettings>
}

export function registerBuiltinCommands(): JSX.Element {
  // This component exists purely so the hooks below can run inside the
  // provider tree. It returns nothing renderable.
  const command = useCommand()
  const dialog = useDialog()
  const agent = useAgent()
  const settings = useSettings()

  command.register(() => buildSpecs({ command, dialog, agent, settings }))
  return null
}

function buildSpecs(deps: BuiltinDeps): CommandSpec[] {
  const { command, dialog, agent, settings } = deps
  return [
    {
      value: "app.help",
      title: "Show help",
      description: "List local commands and key bindings",
      category: "App",
      slash: { name: "help", aliases: ["?"] },
      onSelect: () => {
        agent.pushNotice(renderHelp(command.visible()))
        // Pop any palette/dialog that may have opened this command,
        // so the user is back at a clean prompt.
        dialog.clear()
      },
    },
    {
      value: "app.menu",
      title: "Open menu",
      description: "List every available command. Same as Ctrl+K.",
      category: "App",
      // /menu is the canonical slash; commands/palette stay as aliases
      // for muscle memory.
      slash: { name: "menu", aliases: ["commands", "palette"] },
      onSelect: () => {
        command.show()
      },
    },
    {
      value: "model.list",
      title: "Switch model",
      description: "Pick from your account's available models",
      category: "Agent",
      slash: { name: "models", aliases: ["model"] },
      opensDialog: true,
      onSelect: () => {
        dialog.push(() => <DialogModelList />, { title: "Switch model" })
      },
    },
    {
      value: "session.list",
      title: "Switch session",
      description: "Resume a previous conversation in this project",
      category: "Session",
      slash: { name: "sessions", aliases: ["session", "resume", "continue"] },
      opensDialog: true,
      onSelect: () => {
        dialog.push(() => <DialogSessionList />, { title: "Switch session" })
      },
    },
    {
      value: "settings.scroll_speed",
      title: "Set scroll speed",
      description: `Mouse-wheel lines per tick (${MIN_SCROLL_SPEED}-${MAX_SCROLL_SPEED}). Persists across restarts.`,
      category: "Settings",
      slash: { name: "scroll", aliases: ["scroll-speed", "scrollspeed"] },
      onSelect: (args) => {
        const trimmed = (args ?? "").trim()
        if (!trimmed) {
          // Bare /scroll just shows the current value and the usage.
          agent.pushNotice(
            `/scroll: usage  /scroll <${MIN_SCROLL_SPEED}-${MAX_SCROLL_SPEED}>   (current: ${settings.scrollSpeed()})`,
          )
        } else {
          const n = Number.parseInt(trimmed, 10)
          if (!Number.isFinite(n)) {
            agent.pushNotice(`/scroll: '${trimmed}' is not a number`)
          } else {
            settings.setScrollSpeed(n)
            agent.pushNotice(`/scroll: set to ${settings.scrollSpeed()} lines per tick (saved)`)
          }
        }
        dialog.clear()
      },
    },
    {
      value: "settings.markdown",
      title: "Toggle markdown rendering",
      description: "Render assistant text as formatted markdown (headings, lists, tables, code). Persists.",
      category: "Settings",
      slash: { name: "markdown", aliases: ["md"] },
      onSelect: (args) => {
        const next = parseToggleArg(args, settings.markdown())
        settings.setMarkdown(next)
        agent.pushNotice(`/markdown: ${next ? "on" : "off"} (saved)`)
        dialog.clear()
      },
    },
    {
      value: "settings.markdown_streaming",
      title: "Toggle markdown streaming",
      description: "When markdown is on: render incrementally while text streams (true) or wait until complete (false). Persists.",
      category: "Settings",
      slash: { name: "markdown-stream", aliases: ["md-stream", "mdstream"] },
      onSelect: (args) => {
        const next = parseToggleArg(args, settings.markdownStreaming())
        settings.setMarkdownStreaming(next)
        agent.pushNotice(
          `/markdown-stream: ${next ? "on (live)" : "off (rendered after complete)"} (saved)`,
        )
        dialog.clear()
      },
    },
  ]
}

/**
 * Resolve a toggle command's argument:
 *   - "on" / "true" / "1" / "yes" → true
 *   - "off" / "false" / "0" / "no" → false
 *   - empty / unrecognized → flip current value
 */
function parseToggleArg(args: string | undefined, current: boolean): boolean {
  const v = (args ?? "").trim().toLowerCase()
  if (v === "on" || v === "true" || v === "1" || v === "yes") return true
  if (v === "off" || v === "false" || v === "0" || v === "no") return false
  return !current
}

/**
 * Build the /help notice from the live command registry plus a static
 * navigation / prompt-keys section.
 *
 * Slash commands are auto-derived from the registry — adding a new
 * CommandSpec with a `slash` automatically surfaces it here without
 * touching this file. Aliases are listed in parens after the canonical
 * name. Commands without a slash (palette-only) are skipped.
 *
 * The navigation and prompt sections are static because keyboard
 * bindings live in a separate registry (src/tui/context/keybind.tsx)
 * and aren't kept in sync with the command list. If you change a
 * binding, update the corresponding line below.
 */
function renderHelp(commands: CommandSpec[]): string {
  const slashed = commands.filter((c) => c.slash)
  // Pad the canonical-name column to the longest entry for readable
  // alignment in the plain-text notice.
  const labels = slashed.map(slashLabel)
  const maxLabelLen = labels.reduce((m, s) => Math.max(m, s.length), 0)
  const labelPad = maxLabelLen + 2
  const slashLines = slashed.map((c, i) => {
    const label = labels[i]!.padEnd(labelPad, " ")
    const desc = c.description ?? c.title
    return `  ${label}${desc}`
  })
  return [
    "claude-tui — slash commands:",
    ...slashLines,
    "  Anything else starting with / is forwarded to claude.",
    "",
    "navigation:",
    "  PageUp / PageDown        scroll the message log one page",
    "  Ctrl+Home / Ctrl+End     jump to top / bottom of the log",
    "  Mouse wheel              scroll (use /scroll to tune sensitivity)",
    "  Mouse drag               select text; release auto-copies to clipboard",
    "",
    "prompt:",
    "  Enter                    submit message",
    "  Ctrl+J / Shift+Enter     insert a newline",
    "  Tab                      cycle agent mode (Default ↔ Plan), or",
    "                           complete the highlighted /command",
    "  /                        slash autocomplete in the prompt",
    "  Ctrl+K                   open the command menu",
    "  Ctrl+O                   collapse / expand all tool-output blocks",
    "  Ctrl+C                   clear the prompt; if empty, quit",
    "  Ctrl+D                   quit",
    "  Esc                      close the topmost dialog",
    "  y / n                    accept / deny when a permission prompt is open",
  ].join("\n")
}

/** Render a slash command's display label, with aliases in parens. */
function slashLabel(spec: CommandSpec): string {
  if (!spec.slash) return ""
  const name = "/" + spec.slash.name
  const aliases = spec.slash.aliases ?? []
  if (aliases.length === 0) return name
  return `${name} (${aliases.map((a) => "/" + a).join(", ")})`
}
