/**
 * Global "expanded" state for tool-result blocks. Ctrl+O flips this.
 * Default is `false` (collapsed) so tool output stays compact and the
 * conversation flow doesn't get drowned. The user opts into expanded
 * mode with Ctrl+O when they need to see full output.
 */

import { createContext, createSignal, useContext, type JSX } from "solid-js"

export interface ExpandContextValue {
  expanded: () => boolean
  toggle: () => void
  set: (v: boolean) => void
}

const ExpandContext = createContext<ExpandContextValue | null>(null)

export function ExpandProvider(props: { children: JSX.Element }) {
  const [expanded, setExpanded] = createSignal<boolean>(false) // default collapsed; opt-in to expand
  const value: ExpandContextValue = {
    expanded,
    toggle: () => setExpanded((v) => !v),
    set: setExpanded,
  }
  return <ExpandContext.Provider value={value}>{props.children}</ExpandContext.Provider>
}

export function useExpand(): ExpandContextValue {
  const ctx = useContext(ExpandContext)
  if (!ctx) throw new Error("useExpand() called outside <ExpandProvider>")
  return ctx
}
