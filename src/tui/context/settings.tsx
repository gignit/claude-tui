/**
 * Reactive user-preference state. Mounted high in the provider tree so
 * any component (chat route, slash commands, status line) can read or
 * update prefs without prop-drilling.
 *
 * Each preference:
 *   - has a sensible default
 *   - can be overridden at launch via CLI flag (passed through `initial*`)
 *   - persists to ~/.config/claude-tui/state.json on change
 *
 * Currently the only preference is `scrollSpeed` (lines per scroll-wheel
 * tick). Add new prefs by:
 *   1. Adding the field to PersistedState in src/util/state-store.ts
 *   2. Adding a getter + setter pair to SettingsContextValue
 *   3. Reading it in the consumer (e.g. chat.tsx for layout-affecting
 *      prefs, status-line.tsx for display-affecting prefs)
 */

import { createContext, createSignal, useContext, type JSX } from "solid-js"
import { loadState, saveState } from "../../util/state-store.ts"
import { DEFAULT_SCROLL_SPEED, clampScrollSpeed } from "../../util/scroll.ts"
import { dlog } from "../../util/debug-log.ts"

export interface SettingsContextValue {
  /** Mouse-wheel scroll speed in lines per tick. */
  scrollSpeed: () => number
  setScrollSpeed: (n: number) => void
}

const Ctx = createContext<SettingsContextValue | null>(null)

export interface SettingsProviderProps {
  children: JSX.Element
  /** Override the persisted scroll speed at launch (e.g. from --scroll-speed). */
  initialScrollSpeed?: number
}

export function SettingsProvider(props: SettingsProviderProps) {
  const persisted = loadState()
  const initial = clampScrollSpeed(
    props.initialScrollSpeed ?? persisted.scrollSpeed ?? DEFAULT_SCROLL_SPEED,
  )
  const [scrollSpeed, setScrollSpeedSignal] = createSignal(initial)

  const value: SettingsContextValue = {
    scrollSpeed,
    setScrollSpeed: (n) => {
      const next = clampScrollSpeed(n)
      setScrollSpeedSignal(next)
      saveState({ scrollSpeed: next })
      dlog("settings.scrollSpeed", { value: next })
    },
  }

  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>
}

export function useSettings(): SettingsContextValue {
  const c = useContext(Ctx)
  if (!c) throw new Error("useSettings() called outside <SettingsProvider>")
  return c
}
