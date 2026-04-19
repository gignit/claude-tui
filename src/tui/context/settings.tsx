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
  /** Render assistant text through the markdown renderer. */
  markdown: () => boolean
  setMarkdown: (on: boolean) => void
  /**
   * When markdown is on, also render incrementally while text streams.
   * When false, the bubble shows plain text during streaming and swaps
   * to markdown the moment the message completes.
   */
  markdownStreaming: () => boolean
  setMarkdownStreaming: (on: boolean) => void
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
  // Markdown rendering defaults to ON. The persisted value wins if it
  // was explicitly set (true OR false) — that's why we check `?? true`
  // on the field rather than `|| true` (which would flip false → true).
  const [markdown, setMarkdownSignal] = createSignal<boolean>(persisted.markdown ?? true)
  const [markdownStreaming, setMarkdownStreamingSignal] = createSignal<boolean>(
    persisted.markdownStreaming ?? true,
  )

  const value: SettingsContextValue = {
    scrollSpeed,
    setScrollSpeed: (n) => {
      const next = clampScrollSpeed(n)
      setScrollSpeedSignal(next)
      saveState({ scrollSpeed: next })
      dlog("settings.scrollSpeed", { value: next })
    },
    markdown,
    setMarkdown: (on) => {
      setMarkdownSignal(on)
      saveState({ markdown: on })
      dlog("settings.markdown", { value: on })
    },
    markdownStreaming,
    setMarkdownStreaming: (on) => {
      setMarkdownStreamingSignal(on)
      saveState({ markdownStreaming: on })
      dlog("settings.markdownStreaming", { value: on })
    },
  }

  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>
}

export function useSettings(): SettingsContextValue {
  const c = useContext(Ctx)
  if (!c) throw new Error("useSettings() called outside <SettingsProvider>")
  return c
}
