/**
 * Minimal keybind registry. We just need named actions so the help
 * text and the global handler stay in one place — no leader-key
 * sequences or vim-style multi-step bindings here.
 */

import { createContext, useContext, type JSX } from "solid-js"

export type Action =
  | "scroll_up_line"
  | "scroll_down_line"
  | "scroll_up_page"
  | "scroll_down_page"
  | "scroll_top"
  | "scroll_bottom"
  | "expand_toggle" // Ctrl+O — collapses/expands tool output blocks
  // NOTE: Ctrl+C and Ctrl+D are intentionally NOT global bindings.
  // They are handled by the Prompt component so they can do clear-or-exit
  // semantics based on whether the input has text.

export interface KeyEvent {
  name?: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  raw?: string
}

export interface Binding {
  action: Action
  description: string
  match: (evt: KeyEvent) => boolean
}

export const BINDINGS: Binding[] = [
  {
    action: "expand_toggle",
    description: "Ctrl+O — collapse/expand all tool output blocks",
    match: (e) => e.ctrl === true && e.name === "o",
  },
  {
    action: "scroll_up_page",
    description: "PageUp — scroll up one page",
    match: (e) => e.name === "pageup",
  },
  {
    action: "scroll_down_page",
    description: "PageDown — scroll down one page",
    match: (e) => e.name === "pagedown",
  },
  {
    action: "scroll_top",
    description: "Ctrl+Home — jump to top",
    match: (e) => e.ctrl === true && e.name === "home",
  },
  {
    action: "scroll_bottom",
    description: "Ctrl+End — jump to bottom",
    match: (e) => e.ctrl === true && e.name === "end",
  },
]

export function matchAction(evt: KeyEvent): Action | null {
  for (const b of BINDINGS) {
    if (b.match(evt)) return b.action
  }
  return null
}

const KeybindContext = createContext({ bindings: BINDINGS, match: matchAction })

export function KeybindProvider(props: { children: JSX.Element }) {
  return (
    <KeybindContext.Provider value={{ bindings: BINDINGS, match: matchAction }}>
      {props.children}
    </KeybindContext.Provider>
  )
}

export function useKeybind() {
  return useContext(KeybindContext)
}
