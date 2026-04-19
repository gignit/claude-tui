/**
 * Multi-line prompt input + slash-command autocomplete.
 *
 * Key handling:
 *   - Enter         submit (or, if autocomplete is open, open the palette
 *                   pre-filtered to the highlighted suggestion)
 *   - Ctrl+J        newline
 *   - Shift+Enter   newline (terminal-permitting fallback)
 *   - Ctrl+C        clear the textarea if it has text; if empty, exit
 *   - Ctrl+D        always exit cleanly
 *   - Tab           if autocomplete is open, complete to the suggestion's
 *                   text; otherwise cycle agent mode (Default ↔ Plan)
 *   - Up/Down       move autocomplete selection (only when open)
 *   - Esc           dismiss autocomplete (handled implicitly by clearing
 *                   the leading "/")
 *
 * Slash resolution: typing `/foo` and hitting Enter (without the
 * autocomplete open) tries the command registry first; on match, runs
 * the command. Unknown slashes fall through to the SDK so Claude Code's
 * own slash commands keep working.
 */

import { createMemo, createSignal, onCleanup, Show } from "solid-js"
import type { KeyEvent, TextareaRenderable, KeyBinding as TextareaKeyBinding } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { useTheme } from "../context/theme.tsx"
import { useAgent } from "../context/agent.tsx"
import { useCommand } from "../context/command.tsx"
import { useDialog } from "../context/dialog.tsx"
import { dlog } from "../../util/debug-log.ts"
import { exitTui } from "../../util/exit.ts"
import { PromptAutocomplete, autocompleteSuggestions } from "./prompt-autocomplete.tsx"

const TEXTAREA_KEY_BINDINGS: TextareaKeyBinding[] = [
  { name: "return", action: "submit" },
  { name: "j", ctrl: true, action: "newline" },
  { name: "return", shift: true, action: "newline" },
]

export function Prompt(props: { disabled?: boolean }) {
  const theme = useTheme()
  const agent = useAgent()
  const command = useCommand()
  const dialog = useDialog()
  const renderer = useRenderer()
  const [value, setValue] = createSignal("")
  const [acIndex, setAcIndex] = createSignal(0)
  let textarea: TextareaRenderable | undefined

  // When the dialog overlay just emptied, refocus the textarea so the
  // user can keep typing without clicking. We defer to the next tick so
  // any pending render commits before .focus() runs.
  const unsubscribeClosed = dialog.onClosed(() => {
    setTimeout(() => {
      try {
        if (!textarea) return
        if ((textarea as { isDestroyed?: boolean }).isDestroyed) return
        textarea.focus()
        dlog("prompt.refocus.after_dialog")
      } catch {
        /* ignore — textarea may have been disposed */
      }
    }, 0)
  })
  onCleanup(unsubscribeClosed)

  // Live list of autocomplete suggestions for the current input. Empty
  // when input doesn't start with "/" — used by both the renderer and the
  // key handler to decide whether navigation/Enter should be intercepted.
  const suggestions = createMemo(() => autocompleteSuggestions(command.visible(), value()))
  const acOpen = () => suggestions().length > 0
  const acSelected = () => {
    const list = suggestions()
    if (list.length === 0) return undefined
    return list[Math.max(0, Math.min(acIndex(), list.length - 1))]
  }

  const reset = () => {
    setValue("")
    setAcIndex(0)
    textarea?.clear()
  }

  const moveAc = (delta: number) => {
    const list = suggestions()
    if (list.length === 0) return
    let next = acIndex() + delta
    if (next < 0) next = list.length - 1
    if (next >= list.length) next = 0
    setAcIndex(next)
  }

  const completeFromAutocomplete = () => {
    const sel = acSelected()
    if (!sel) return false
    // Replace the user's leading "/foo" token with the canonical insertText.
    // Anything after the first whitespace token (args) is preserved.
    const original = value()
    const splitAt = original.indexOf(" ")
    const rest = splitAt === -1 ? "" : original.slice(splitAt)
    const next = sel.insertText + rest
    textarea?.setText(next)
    setValue(next)
    setAcIndex(0)
    dlog("prompt.autocomplete.tab", { value: sel.spec.value })
    return true
  }

  const onKeyDown = (e: KeyEvent) => {
    // Ctrl+C: clear the prompt if it has any text, else exit cleanly.
    if (e.ctrl && e.name === "c") {
      if (value().length > 0) {
        dlog("prompt.ctrl_c.clear")
        reset()
      } else {
        dlog("prompt.ctrl_c.exit")
        exitTui(renderer)
      }
      e.preventDefault()
      return
    }
    // Ctrl+D: always exit cleanly.
    if (e.ctrl && e.name === "d") {
      dlog("prompt.ctrl_d.exit")
      exitTui(renderer)
      e.preventDefault()
      return
    }
    // Autocomplete navigation has priority over global Tab/Up/Down.
    if (acOpen()) {
      if (e.name === "up") {
        moveAc(-1)
        e.preventDefault()
        return
      }
      if (e.name === "down") {
        moveAc(1)
        e.preventDefault()
        return
      }
      if (e.name === "tab" && !e.shift && !e.ctrl && !e.meta) {
        completeFromAutocomplete()
        e.preventDefault()
        return
      }
    }
    // Tab (with no autocomplete open) cycles agent mode.
    if (e.name === "tab" && !e.shift && !e.ctrl && !e.meta) {
      dlog("prompt.tab.cycle_mode")
      void agent.cycleMode()
      e.preventDefault()
      return
    }
  }

  /**
   * Handle Enter behavior. When the autocomplete is open, Enter fires
   * the highlighted command directly (the user's revised UX — no
   * intermediate palette stop). Otherwise we run the standard slash
   * resolution / agent submission.
   */
  const submit = () => {
    if (acOpen()) {
      const sel = acSelected()
      if (sel) {
        dlog("prompt.autocomplete.enter", { value: sel.spec.value })
        command.trigger(sel.spec.value)
        reset()
        return
      }
    }
    const trimmed = value().trim()
    dlog("prompt.submit", { length: trimmed.length, preview: trimmed.slice(0, 80) })
    if (!trimmed) return

    if (trimmed.startsWith("/") && handleSlashCommand(trimmed)) {
      reset()
      return
    }

    agent.submit(trimmed)
    reset()
  }

  /** Slash-command lookup. Returns true if the command was triggered. */
  const handleSlashCommand = (raw: string): boolean => {
    const head = raw.split(/\s+/, 1)[0] ?? ""
    if (!head.startsWith("/")) return false
    const cmd = command.bySlash(head)
    if (!cmd) return false
    dlog("prompt.slash.match", { name: head, value: cmd.value })
    void cmd.onSelect()
    return true
  }

  return (
    <box flexDirection="column" flexShrink={0}>
      <Show when={acOpen()}>
        <PromptAutocomplete inputValue={value()} selectedIndex={acIndex()} />
      </Show>
      <box
        flexShrink={0}
        flexDirection="row"
        borderColor={theme.border}
        border={["top", "bottom", "left", "right"]}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={theme.backgroundPanel}
      >
        <text fg={theme.primary}>{"> "}</text>
        <textarea
          ref={textarea}
          focused={!props.disabled}
          placeholder={agent.items.length === 0 ? "ask Claude ... (Enter to send | ctrl+j newline | ctrl+k menu | / for menu)" : ""}
          keyBindings={TEXTAREA_KEY_BINDINGS}
          minHeight={1}
          maxHeight={6}
          onContentChange={() => {
            const text = textarea?.plainText ?? ""
            setValue(text)
            // Reset selection whenever the input changes; the new
            // suggestion list may be shorter than where we were.
            setAcIndex(0)
            dlog("prompt.change", { length: text.length })
          }}
          onKeyDown={onKeyDown}
          onSubmit={submit}
          flexGrow={1}
        />
      </box>
    </box>
  )
}
