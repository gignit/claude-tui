/**
 * Command registry. Components register commands; the registry collects
 * them into a single flat list. Three consumers:
 *
 *   1. Ctrl+K palette (DialogCommand) — shows everything visible
 *   2. /xxx in the prompt — looked up via slashName
 *   3. Direct trigger() by id — useful for keybindings or tests
 *
 * No keybind matching here — global hotkeys live in `chat.tsx`'s
 * `useKeyboard` and call `command.trigger(value)`. Commands themselves
 * only declare a slash invocation.
 *
 * `register()` accepts an Accessor so commands can be reactive (their
 * `enabled` / `hidden` / `title` can change with signals). Registrations
 * are auto-cleaned on component unmount via onCleanup.
 */

import { type Accessor, type JSX, type ParentProps, createContext, createMemo, createSignal, onCleanup, useContext } from "solid-js"
import { useDialog } from "./dialog.tsx"
import { dlog } from "../../util/debug-log.ts"

export interface CommandSlash {
  /** Lowercase, no leading "/". e.g. "models". */
  name: string
  /** Optional aliases. e.g. ["model"]. */
  aliases?: string[]
}

export interface CommandSpec {
  /** Stable id. Used by trigger() and as React key in the palette. */
  value: string
  /** Display title in the palette. */
  title: string
  /** Optional one-line description shown beneath the title. */
  description?: string
  /** Group label in the palette. */
  category?: string
  /** When false, command is filtered out of every list. Defaults to true. */
  enabled?: boolean
  /** When true, command stays out of the palette but can still be triggered programmatically. */
  hidden?: boolean
  /** Slash invocation. If present, typing /<name> or /<alias> in the prompt triggers this. */
  slash?: CommandSlash
  /**
   * If true, this command's onSelect pushes a sub-dialog onto the stack.
   * `command.trigger` will ensure the Commands palette is on the stack
   * as the root before invoking onSelect, so the breadcrumb always
   * shows "Commands › <this title>" — regardless of whether the user
   * typed the slash, picked from the palette, or used a hotkey.
   *
   * Set to `false` (or omit) for action commands that just run
   * synchronously and don't open a follow-up dialog (e.g. /help).
   */
  opensDialog?: boolean
  /**
   * Invoked when the user picks the command. Receives the dialog
   * controller so you can `.replace(...)` to chain into another dialog
   * or `.clear()` to dismiss.
   */
  onSelect: () => void | Promise<void>
}

export interface CommandContext {
  /** Re-evaluated reactively. */
  list: () => CommandSpec[]
  /** All visible (enabled and not hidden) commands. */
  visible: () => CommandSpec[]
  /** Look up by slash name OR alias (case-insensitive, no leading /). */
  bySlash: (name: string) => CommandSpec | undefined
  /** Trigger a command by `value`. */
  trigger: (value: string) => void
  /** Open the palette. Optional initialFilter to scope the view. */
  show: (initialFilter?: string) => void
  /**
   * Register a command. The function may be reactive (called whenever
   * tracked signals change). Returns nothing — cleanup happens via
   * onCleanup of the calling component.
   */
  register: (factory: () => CommandSpec[]) => void
}

const Ctx = createContext<CommandContext | null>(null)

export function CommandProvider(props: ParentProps & { paletteRenderer: (initialFilter: string) => JSX.Element }) {
  const dialog = useDialog()
  const [registrations, setRegistrations] = createSignal<Accessor<CommandSpec[]>[]>([])

  const list = createMemo(() => registrations().flatMap((fn) => fn()))
  const visible = createMemo(() => list().filter((c) => c.enabled !== false && !c.hidden))

  const value: CommandContext = {
    list,
    visible,
    bySlash(raw) {
      const needle = raw.replace(/^\/+/, "").toLowerCase()
      if (!needle) return undefined
      for (const cmd of visible()) {
        const slash = cmd.slash
        if (!slash) continue
        if (slash.name.toLowerCase() === needle) return cmd
        if (slash.aliases?.some((a) => a.toLowerCase() === needle)) return cmd
      }
      return undefined
    },
    trigger(target) {
      for (const cmd of list()) {
        if (cmd.value !== target) continue
        if (cmd.enabled === false) return
        dlog("command.trigger", { value: target })
        // If this command opens a sub-dialog and nothing is on the stack
        // yet, drop the palette underneath as the breadcrumb root so
        // the user can always navigate back to the full command list.
        if (cmd.opensDialog && dialog.size() === 0) {
          dlog("command.trigger.seed_palette", { value: target })
          dialog.replace(() => props.paletteRenderer(""), { title: "Menu" })
        }
        try {
          void cmd.onSelect()
        } catch (err) {
          dlog("command.trigger.error", { value: target, error: String(err) })
        }
        return
      }
      dlog("command.trigger.miss", { value: target })
    },
    show(initialFilter) {
      dlog("command.show", { initialFilter })
      dialog.replace(() => props.paletteRenderer(initialFilter ?? ""), { title: "Menu" })
    },
    register(factory) {
      const memo = createMemo(factory)
      setRegistrations((arr) => [...arr, memo])
      onCleanup(() => {
        setRegistrations((arr) => arr.filter((x) => x !== memo))
      })
    },
  }

  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>
}

export function useCommand(): CommandContext {
  const c = useContext(Ctx)
  if (!c) throw new Error("useCommand() called outside <CommandProvider>")
  return c
}
