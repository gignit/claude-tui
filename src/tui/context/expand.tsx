/**
 * Tool-block expansion state.
 *
 * Two layers:
 *   - GLOBAL `expanded` state (toggled by Ctrl+O). Defaults to false
 *     (collapsed) so tool output stays compact on first render.
 *   - PER-TOOL OVERRIDE set. Clicking a single tool flips its membership
 *     in this set; the per-tool effective state is then `global XOR
 *     overrides.has(id)`.
 *
 * That means:
 *   - Ctrl+O flips the global state but PRESERVES per-tool overrides
 *     (they invert relative to the new global). This matches the user
 *     spec: "still keep the global status of expanded or contracted".
 *   - Clicking a tool a second time removes its override, snapping it
 *     back to whatever global says.
 */

import { createContext, createSignal, useContext, type JSX } from "solid-js"
import { createStore, produce } from "solid-js/store"

export interface ExpandContextValue {
  /** Reactive global state. */
  expanded: () => boolean
  /** Flip global; per-tool overrides untouched. */
  toggle: () => void
  /** Set global directly. */
  set: (v: boolean) => void
  /** Effective state for a specific tool block id. */
  isExpanded: (id: string) => boolean
  /**
   * Flip the per-tool override membership for `id`. After this call,
   * the tool's effective state is the opposite of what it was before.
   */
  toggleOne: (id: string) => void
}

const ExpandContext = createContext<ExpandContextValue | null>(null)

export function ExpandProvider(props: { children: JSX.Element }) {
  const [expanded, setExpanded] = createSignal<boolean>(false)
  // Solid store of overrides — keyed by tool id, value is always `true`
  // (we just track membership). createStore so the read is reactive
  // (createSignal<Set> isn't reactive on member changes).
  const [overrides, setOverrides] = createStore<Record<string, boolean>>({})

  const value: ExpandContextValue = {
    expanded,
    toggle: () => setExpanded((v) => !v),
    set: setExpanded,
    isExpanded: (id) => {
      const overridden = overrides[id] === true
      // XOR: when the global is true and override is set, the override
      // means "this one should be opposite", i.e. collapsed.
      return overridden ? !expanded() : expanded()
    },
    toggleOne: (id) => {
      setOverrides(produce((o) => {
        if (o[id]) delete o[id]
        else o[id] = true
      }))
    },
  }
  return <ExpandContext.Provider value={value}>{props.children}</ExpandContext.Provider>
}

export function useExpand(): ExpandContextValue {
  const ctx = useContext(ExpandContext)
  if (!ctx) throw new Error("useExpand() called outside <ExpandProvider>")
  return ctx
}
