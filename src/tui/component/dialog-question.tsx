/**
 * Modal dialog for the SDK's `AskUserQuestion` tool.
 *
 * The Claude binary's built-in picker for AskUserQuestion can't render
 * inside an SDK subprocess (no controlling TTY), so the binary returns
 * an empty answer and Claude is left guessing. The fix is to intercept
 * the tool call in our `canUseTool` hook, surface the questions here,
 * and feed the user's answers back via the SDK's `updatedInput.answers`
 * channel — the tool then short-circuits its picker and uses our
 * answers as the result.
 *
 * UX
 * --
 * One question at a time, with a "{i}/{n}" badge in the title bar so
 * the user knows progress. For each question:
 *
 *   - Header (Claude's short tag, e.g. "Format")
 *   - Full question text
 *   - Numbered options (1..N) with the option's `description` underneath
 *   - "Other:" row with a text input for free-text answers
 *
 * Single-select question:
 *   - 1..N to pick an option directly
 *   - ↑/↓ + Enter to navigate + pick
 *   - Tab into the "Other" input, type, Enter to submit free text
 *
 * Multi-select question:
 *   - 1..N to toggle that option in/out of the selection set
 *   - ↑/↓ + Space to toggle the highlighted option
 *   - Enter to confirm the current selection (joins labels with ", ")
 *   - Tab into "Other"; whatever's in the input is appended to the
 *     selection on Enter.
 *
 * Esc cancels the whole question, which gets surfaced to the SDK as a
 * tool denial — Claude sees `{behavior: "deny", message: "user
 * cancelled the question"}` and decides what to do next.
 */

import { For, Show, createEffect, createMemo, createSignal, onMount } from "solid-js"
import type { InputRenderable, KeyEvent } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "../context/theme.tsx"
import type { QuestionRequest } from "../../agent/types.ts"
import { dlog } from "../../util/debug-log.ts"

export function DialogQuestion(props: { request: QuestionRequest }) {
  const theme = useTheme()
  const [qIdx, setQIdx] = createSignal(0)
  // Accumulated answers across questions. Keyed by the question text
  // (the SDK matches answers to questions by exact key match).
  const answers: Record<string, string> = {}
  // Per-question state. Reset whenever we advance to a new question.
  const [highlight, setHighlight] = createSignal(0)
  const [toggled, setToggled] = createSignal<ReadonlySet<number>>(new Set())
  const [otherText, setOtherText] = createSignal("")
  const [otherFocused, setOtherFocused] = createSignal(false)
  let otherInput: InputRenderable | undefined

  const question = () => props.request.questions[qIdx()]
  const isMulti = () => question()?.multiSelect ?? false
  const total = () => props.request.questions.length
  const optionCount = () => question()?.options.length ?? 0

  // Reset transient per-question state when we advance.
  createEffect(() => {
    qIdx() // dependency tracker
    setHighlight(0)
    setToggled(new Set<number>())
    setOtherText("")
    setOtherFocused(false)
    if (otherInput) otherInput.value = ""
  })

  const finishQuestion = (value: string) => {
    const q = question()
    if (!q) return
    answers[q.question] = value
    dlog("dialog.question.answer", { idx: qIdx(), question: q.question, value })
    if (qIdx() + 1 < total()) {
      setQIdx(qIdx() + 1)
    } else {
      // All questions answered — resolve back to the SDK.
      // Snapshot the answers map; further mutation can't reach the
      // resolver after this anyway.
      props.request.resolve({ ...answers })
    }
  }

  /** Build the comma-joined label for a multi-select submission. */
  const buildMultiAnswer = (): string => {
    const q = question()
    if (!q) return ""
    const labels: string[] = []
    const set = toggled()
    for (let i = 0; i < q.options.length; i++) {
      if (set.has(i)) labels.push(q.options[i]!.label)
    }
    const other = otherText().trim()
    if (other) labels.push(other)
    return labels.join(", ")
  }

  const submitMulti = () => {
    const value = buildMultiAnswer()
    if (value.length === 0) {
      // Nothing selected and no free text — block submission with a
      // visual nudge by leaving the dialog open. (Eventually we might
      // show an inline error; for now silent ignore is fine.)
      return
    }
    finishQuestion(value)
  }

  const submitSingle = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    finishQuestion(trimmed)
  }

  const toggleOption = (idx: number) => {
    if (idx < 0 || idx >= optionCount()) return
    const next = new Set(toggled())
    if (next.has(idx)) next.delete(idx)
    else next.add(idx)
    setToggled(next)
  }

  const cancel = () => {
    dlog("dialog.question.cancel")
    props.request.resolve(null)
  }

  /**
   * Handler for keys when the option list (not the Other text input)
   * has focus. Returns true if the key was consumed.
   */
  const handleListKey = (e: KeyEvent): boolean => {
    if (e.name === "escape") {
      cancel()
      return true
    }
    if (e.name === "up") {
      setHighlight(Math.max(0, highlight() - 1))
      return true
    }
    if (e.name === "down") {
      setHighlight(Math.min(optionCount() - 1, highlight() + 1))
      return true
    }
    if (e.name === "tab" && !e.shift) {
      setOtherFocused(true)
      otherInput?.focus()
      return true
    }
    if (e.name === "return") {
      if (isMulti()) {
        submitMulti()
      } else {
        const opt = question()?.options[highlight()]
        if (opt) submitSingle(opt.label)
      }
      return true
    }
    if (e.name === "space" && isMulti()) {
      toggleOption(highlight())
      return true
    }
    // Numeric direct-pick: 1..9 → option (idx-1)
    const n = e.name && /^[1-9]$/.test(e.name) ? Number(e.name) : NaN
    if (Number.isFinite(n) && n >= 1 && n <= optionCount()) {
      const idx = n - 1
      if (isMulti()) {
        toggleOption(idx)
      } else {
        const opt = question()?.options[idx]
        if (opt) submitSingle(opt.label)
      }
      return true
    }
    return false
  }

  /**
   * Handler for keys when the "Other" input has focus. Returns true
   * if the key was consumed by the dialog (so it shouldn't propagate
   * to other handlers).
   */
  const handleInputKey = (e: KeyEvent): boolean => {
    if (e.name === "escape") {
      cancel()
      return true
    }
    if (e.name === "tab") {
      // Tab (with or without Shift): toggle focus back to the option
      // list. Symmetric with the option-list handler that Tabs INTO
      // the input — pressing Tab repeatedly walks back and forth.
      setOtherFocused(false)
      return true
    }
    if (e.name === "return") {
      if (isMulti()) {
        submitMulti()
      } else {
        submitSingle(otherText())
      }
      return true
    }
    return false
  }

  // Single global keyboard handler — opentui's input renderable will
  // also receive its own keypresses for typing, but we intercept
  // navigation/submit here. preventDefault + stopPropagation to keep
  // these keys from leaking to chat-level scroll bindings or the
  // outer prompt textarea.
  useKeyboard((e) => {
    const consumed = otherFocused() ? handleInputKey(e) : handleListKey(e)
    if (consumed) {
      e.preventDefault()
      e.stopPropagation()
    }
  })

  // Auto-focus the option list on mount. (We don't focus the input
  // because most single-select answers are picked from options; the
  // user explicitly Tabs into the input for free text.)
  onMount(() => {
    setOtherFocused(false)
    setHighlight(0)
  })

  return (
    <box
      flexShrink={0}
      flexDirection="column"
      borderColor={theme.warn}
      border={["top", "bottom", "left", "right"]}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={theme.backgroundPanel}
      gap={1}
    >
      {/* Title row — progress badge + cancel hint. Uses warn color
          so the dialog reads as an interactive prompt, not background
          chrome. */}
      <box flexDirection="row" gap={1} flexShrink={0}>
        <text fg={theme.warn}>{`question ${qIdx() + 1}/${total()}`}</text>
        <Show when={isMulti()}>
          <text fg={theme.textDim}>{"(multi-select)"}</text>
        </Show>
        <box flexGrow={1} />
        <text fg={theme.textDim}>{"Esc to cancel"}</text>
      </box>

      {/* Header tag (Claude's short label, e.g. "Format") + full
          question text. Header is dim because the question text
          itself is what the user reads. */}
      <Show when={question()?.header}>
        <text fg={theme.textMuted}>{question()!.header}</text>
      </Show>
      <text fg={theme.text}>{question()?.question ?? ""}</text>

      {/* Options. Each row shows: highlight marker, optional checkbox
          (multi-select), number, label. The description is on the next
          line, indented and dim. */}
      <box flexDirection="column" flexShrink={0}>
        <For each={question()?.options ?? []}>
          {(opt, i) => {
            const active = createMemo(() => !otherFocused() && i() === highlight())
            const checked = createMemo(() => isMulti() && toggled().has(i()))
            const marker = () => (active() ? "›" : " ")
            const box = () => (isMulti() ? (checked() ? "[x] " : "[ ] ") : "")
            const num = () => `${i() + 1}.`
            return (
              <box
                flexDirection="column"
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={active() ? theme.backgroundElement : theme.backgroundPanel}
              >
                <text fg={active() ? theme.primary : theme.text}>
                  {`${marker()} ${box()}${num()} ${opt.label}`}
                </text>
                <Show when={opt.description}>
                  <text fg={theme.textDim}>{`     ${opt.description}`}</text>
                </Show>
              </box>
            )
          }}
        </For>
      </box>

      {/* Free-text "Other" row. Always rendered — keeps layout stable
          and gives the user a clear way to type a custom answer. */}
      <box flexDirection="column" flexShrink={0}>
        <text fg={otherFocused() ? theme.primary : theme.textMuted}>
          {otherFocused() ? "› Other:" : "  Other (Tab to type your own):"}
        </text>
        <box
          flexDirection="row"
          paddingLeft={1}
          paddingRight={1}
          borderColor={otherFocused() ? theme.primary : theme.border}
          border={["top", "bottom", "left", "right"]}
          backgroundColor={theme.background}
        >
          <text fg={theme.primary}>{"> "}</text>
          <input
            ref={otherInput}
            focused={otherFocused()}
            placeholder={isMulti() ? "(optional, appended to selection)" : "type and press Enter"}
            onInput={(value) => setOtherText(value)}
            flexGrow={1}
          />
        </box>
      </box>

      {/* Footer hint line — keystroke cheat-sheet for the current
          question's mode. */}
      <text fg={theme.textDim}>
        {isMulti()
          ? "1-9 toggle · Space toggle · Enter submit · Tab → free text"
          : "1-9 pick · ↑/↓ + Enter pick · Tab → free text"}
      </text>
    </box>
  )
}
