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
import { DialogVariantList } from "../component/dialog-variant.tsx"
import { DialogSessionList } from "../component/dialog-session.tsx"
import { DialogRewindList } from "../component/dialog-rewind.tsx"
import { MAX_SCROLL_SPEED, MIN_SCROLL_SPEED } from "../../util/scroll.ts"
import { levelLabel, modeLabel, parsePermissionLevel } from "../../agent/modes.ts"

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
      description: "Pick from your account's available models, or /model <id|alias> to set directly",
      category: "Agent",
      slash: { name: "models", aliases: ["model"] },
      opensDialog: true,
      onSelect: (args) => {
        const wanted = (args ?? "").trim()
        if (!wanted) {
          dialog.push(() => <DialogModelList />, { title: "Switch model" })
          return
        }
        // `/model fable` parity with the claude CLI: match the arg
        // against the supported list (id, resolved id, display name,
        // case-insensitive), and fall through to the raw string for
        // anything the list doesn't carry — the CLI accepts arbitrary
        // ids/aliases (e.g. claude-opus-4-7) and errors if invalid.
        dialog.clear()
        void agent.listModels().then(async (models) => {
          const needle = wanted.toLowerCase()
          const match = models.find(
            (m) =>
              m.id.toLowerCase() === needle ||
              m.resolvedModel?.toLowerCase() === needle ||
              m.displayName.toLowerCase() === needle,
          )
          const id = match?.id ?? wanted
          await agent.setModel(id)
          agent.pushNotice(
            match
              ? `/model: ${match.displayName} (${match.resolvedModel ?? match.id})`
              : `/model: ${wanted} (not in the model list — passed through as-is)`,
          )
        })
      },
    },
    {
      value: "model.variant",
      title: "Set reasoning effort",
      description: "Pick the model's effort variant (low/medium/high/xhigh/max, or default)",
      category: "Agent",
      slash: { name: "variant", aliases: ["effort"] },
      opensDialog: true,
      onSelect: () => {
        dialog.push(() => <DialogVariantList />, { title: "Reasoning effort" })
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
      value: "agent.permissions",
      title: "Set permission level",
      description: "default (prompt) · accept (auto-approve edits) · bypass (no prompts). Separate from Tab's Default/Plan mode. Persists.",
      category: "Agent",
      slash: { name: "permissions", aliases: ["permission", "yolo"] },
      onSelect: (args) => {
        dialog.clear()
        const trimmed = (args ?? "").trim()
        if (!trimmed) {
          agent.pushNotice(
            `/permissions: level is ${levelLabel(agent.permissionLevel())}  ·  mode is ${modeLabel(agent.mode())} (Tab toggles mode)\n` +
              `  usage: /permissions <default|accept|bypass>\n` +
              `  (or launch with --permission-mode <level> / --dangerously-skip-permissions)`,
          )
          return
        }
        if (trimmed.toLowerCase() === "plan") {
          agent.pushNotice("/permissions: Plan is a mode, not a permission level — press Tab to toggle Default ↔ Plan")
          return
        }
        const level = parsePermissionLevel(trimmed)
        if (!level) {
          agent.pushNotice(`/permissions: unknown level '${trimmed}' — valid: default, accept, bypass`)
          return
        }
        void agent.setPermissionLevel(level).then(() => {
          agent.pushNotice(`/permissions: ${levelLabel(level)} (saved — future sessions start this way)`)
        })
      },
    },
    {
      value: "session.fork",
      title: "Fork session",
      description: "Branch the conversation into a new session; the original stays untouched",
      category: "Session",
      slash: { name: "fork" },
      onSelect: () => {
        dialog.clear()
        if (!agent.sessionId()) {
          agent.pushNotice("/fork: no active session yet — send a message first")
          return
        }
        void agent.forkSession().then(() => {
          agent.pushNotice("/fork: branched into a new session (original preserved)")
        })
      },
    },
    {
      value: "session.rename",
      title: "Rename session",
      description: "Set a custom title for the current session (shown in the control panel and /sessions)",
      category: "Session",
      slash: { name: "rename", aliases: ["title"] },
      onSelect: (args) => {
        dialog.clear()
        const title = (args ?? "").trim()
        if (!title) {
          agent.pushNotice("/rename: usage  /rename <new title>")
          return
        }
        void agent
          .renameCurrentSession(title)
          .then(() => agent.pushNotice(`/rename: session titled '${title}'`))
          .catch((err) =>
            agent.pushNotice(`/rename: ${err instanceof Error ? err.message : String(err)}`),
          )
      },
    },
    {
      value: "session.rewind",
      title: "Rewind conversation",
      description: "Pick a past turn; restore files to it and drop everything after",
      category: "Session",
      slash: { name: "rewind", aliases: ["undo"] },
      opensDialog: true,
      onSelect: () => {
        if (!agent.sessionId()) {
          agent.pushNotice("/rewind: no active session yet — send a message first")
          dialog.clear()
          return
        }
        dialog.push(() => <DialogRewindList />, { title: "Rewind" })
      },
    },
    {
      value: "session.context",
      title: "Show context usage",
      description: "Claude Code's /context breakdown plus the live token count",
      category: "Session",
      slash: { name: "context", aliases: ["ctx"] },
      onSelect: () => {
        dialog.clear()
        const u = agent.contextUsage()
        if (u) {
          agent.pushNotice(
            `context: ${u.totalTokens.toLocaleString()} of ${u.maxTokens.toLocaleString()} tokens (${Math.round(u.percentage)}%)`,
          )
        }
        // Forward to the CLI for the full per-category breakdown —
        // the response arrives as a local_command_output system
        // message, which the client renders as an info notice.
        agent.submit("/context")
      },
    },
    {
      value: "session.compact",
      title: "Compact context",
      description: "Summarize the conversation to reclaim context window space",
      category: "Session",
      slash: { name: "compact" },
      onSelect: (args) => {
        dialog.clear()
        // Forward to the CLI (supports an optional focus instruction:
        // `/compact keep the debugging details`). Progress shows via
        // the 'compacting' status; the compact_boundary system message
        // reports the token delta when done.
        agent.submit(args && args.trim() ? `/compact ${args.trim()}` : "/compact")
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
      value: "settings.markdown_legacy",
      title: "Toggle legacy markdown renderer",
      description: "Fall back to the pre-opentui-0.4 segment renderer (hand-rolled rules/blockquotes). Persists.",
      category: "Settings",
      slash: { name: "markdown-legacy", aliases: ["md-legacy"] },
      onSelect: (args) => {
        const next = parseToggleArg(args, settings.markdownLegacy())
        settings.setMarkdownLegacy(next)
        agent.pushNotice(`/markdown-legacy: ${next ? "on (legacy segment renderer)" : "off (opentui native)"} (saved)`)
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
    {
      value: "settings.control_panel",
      title: "Toggle control panel",
      description: "Right-hand panel with session info, context usage, MCP servers, and todos. Persists.",
      category: "Settings",
      slash: { name: "controlpanel", aliases: ["panel", "cp"] },
      onSelect: (args) => {
        const next = parseToggleArg(args, settings.controlPanel())
        settings.setControlPanel(next)
        agent.pushNotice(`/controlpanel: ${next ? "shown" : "hidden"} (saved)`)
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
