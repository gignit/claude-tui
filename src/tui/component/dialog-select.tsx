/**
 * Reusable list-picker primitive shown inside a Dialog. Used by the
 * command menu, model picker, session picker, etc.
 *
 * Behavior:
 *   - On mount the search input auto-focuses.
 *   - Up/Down (or Ctrl+P/Ctrl+N) move selection.
 *   - Enter selects.
 *   - Mouse click on a row also selects.
 *   - Filter is a case-insensitive substring match against title + subtitle.
 *
 * The selected callback receives the raw option, and the component does
 * NOT close the dialog itself — the caller decides whether to close,
 * push another dialog, etc.
 */

import { For, Show, createMemo, createSignal, onMount } from "solid-js"
import type { InputRenderable, ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions, useKeyboard } from "@opentui/solid"
import { useTheme } from "../context/theme.tsx"
import { dlog } from "../../util/debug-log.ts"

export interface DialogSelectOption<T> {
  /** Value handed back to onSelect. Must be unique across options. */
  value: T
  title: string
  subtitle?: string
  /** Optional right-aligned hint (e.g. keyboard shortcut). */
  hint?: string
  disabled?: boolean
}

export interface DialogSelectProps<T> {
  title: string
  options: DialogSelectOption<T>[]
  /** Initial filter text (e.g. for jumping into a slash command). */
  initialFilter?: string
  /** Pre-select the option whose value equals this (===). */
  initial?: T
  placeholder?: string
  emptyMessage?: string
  /** Callback when the user picks an option (Enter or click). */
  onSelect: (option: DialogSelectOption<T>) => void
}

export function DialogSelect<T>(props: DialogSelectProps<T>) {
  const theme = useTheme()
  const dimensions = useTerminalDimensions()
  const [filter, setFilter] = createSignal(props.initialFilter ?? "")
  const [selectedIndex, setSelectedIndex] = createSignal(0)
  let inputRef: InputRenderable | undefined
  let scrollRef: ScrollBoxRenderable | undefined

  const filtered = createMemo<DialogSelectOption<T>[]>(() => {
    const needle = filter().trim().toLowerCase()
    const enabled = props.options.filter((o) => !o.disabled)
    if (!needle) return enabled
    return enabled.filter((o) => {
      const hay = (o.title + " " + (o.subtitle ?? "")).toLowerCase()
      return hay.includes(needle)
    })
  })

  // Keep selection in bounds when filter shrinks the list.
  createMemo(() => {
    const max = filtered().length - 1
    if (max < 0) {
      setSelectedIndex(0)
      return
    }
    if (selectedIndex() > max) setSelectedIndex(max)
  })

  // Pre-select the requested initial value once on mount.
  onMount(() => {
    if (props.initial !== undefined) {
      const idx = filtered().findIndex((o) => o.value === props.initial)
      if (idx >= 0) setSelectedIndex(idx)
    }
    // Defer focus to the next tick so the renderer has mounted the input.
    setTimeout(() => {
      try {
        inputRef?.focus()
      } catch {
        /* ignore */
      }
    }, 0)
  })

  const move = (delta: number) => {
    const list = filtered()
    if (list.length === 0) return
    let next = selectedIndex() + delta
    if (next < 0) next = list.length - 1
    if (next >= list.length) next = 0
    setSelectedIndex(next)
  }

  const accept = () => {
    const opt = filtered()[selectedIndex()]
    if (!opt) return
    dlog("dialog-select.accept", { title: opt.title })
    props.onSelect(opt)
  }

  // We only handle navigation keys; the input field swallows printable chars.
  useKeyboard((evt) => {
    // Only intervene when an option is highlighted — otherwise let the
    // input's own keymap (including default Enter→nothing) win.
    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      move(-1)
      evt.preventDefault()
      return
    }
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      move(1)
      evt.preventDefault()
      return
    }
    if (evt.name === "pageup") {
      move(-5)
      evt.preventDefault()
      return
    }
    if (evt.name === "pagedown") {
      move(5)
      evt.preventDefault()
      return
    }
    if (evt.name === "return") {
      accept()
      evt.preventDefault()
      return
    }
  })

  // Cap the option list height so the dialog stays inside the viewport.
  const listMaxHeight = createMemo(() => Math.max(4, Math.floor(dimensions().height / 2)))

  return (
    <box flexDirection="column" gap={1}>
      <text fg={theme.text}>{props.title}</text>
      <input
        ref={inputRef}
        placeholder={props.placeholder ?? "Type to filter…"}
        focusedBackgroundColor={theme.backgroundElement}
        focusedTextColor={theme.text}
        cursorColor={theme.primary}
        onInput={(value) => setFilter(value)}
      />
      <Show
        when={filtered().length > 0}
        fallback={<text fg={theme.textMuted}>{props.emptyMessage ?? "No matches"}</text>}
      >
        <scrollbox
          ref={scrollRef}
          maxHeight={listMaxHeight()}
          stickyScroll={false}
          scrollbarOptions={{ visible: false }}
          viewportOptions={{ paddingRight: 1 }}
        >
          <For each={filtered()}>
            {(option, idx) => {
              const active = createMemo(() => idx() === selectedIndex())
              return (
                <box
                  flexDirection="column"
                  paddingLeft={1}
                  paddingRight={1}
                  paddingTop={idx() === 0 ? 0 : 1}
                  backgroundColor={active() ? theme.backgroundElement : theme.backgroundPanel}
                  onMouseDown={() => setSelectedIndex(idx())}
                  onMouseUp={() => {
                    setSelectedIndex(idx())
                    accept()
                  }}
                >
                  {/* row 1: chevron + title (left) and the optional hint (right) */}
                  <box flexDirection="row" flexShrink={0}>
                    <text fg={active() ? theme.primary : theme.text}>
                      {(active() ? "› " : "  ") + option.title}
                    </text>
                    <box flexGrow={1} />
                    <Show when={option.hint}>
                      <text fg={theme.textDim}>{option.hint}</text>
                    </Show>
                  </box>
                  {/* row 2: subtitle on its own line, indented to align with title */}
                  <Show when={option.subtitle}>
                    <box flexDirection="row" flexShrink={0} paddingLeft={2}>
                      <text fg={theme.textMuted}>{option.subtitle}</text>
                    </box>
                  </Show>
                </box>
              )
            }}
          </For>
        </scrollbox>
      </Show>
    </box>
  )
}
