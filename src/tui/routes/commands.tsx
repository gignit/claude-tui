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
      description: "List local commands",
      category: "App",
      slash: { name: "help", aliases: ["?"] },
      onSelect: () => {
        agent.pushNotice(
          [
            "claude-tui local commands:",
            "  /help            this message",
            "  /models          pick a model",
            "  /sessions        switch sessions for the current project",
            "  /menu            open the command menu (also Ctrl+K)",
            "Anything else starting with / is forwarded to claude.",
          ].join("\n"),
        )
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
  ]
}
