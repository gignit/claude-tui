/**
 * Static color palette. We keep one hard-coded dark theme to keep this
 * project small; swap to a JSON-loader if you need user themes later.
 */

import { createContext, useContext, type JSX } from "solid-js"

export interface Theme {
  background: string
  backgroundPanel: string
  backgroundElement: string
  border: string
  text: string
  textMuted: string
  textDim: string
  primary: string
  accent: string
  user: string
  assistant: string
  tool: string
  toolMuted: string
  error: string
  warn: string
  success: string
  thinking: string
}

export const DARK_THEME: Theme = {
  background: "#0a0a0a",
  backgroundPanel: "#141414",
  backgroundElement: "#1f1f1f",
  border: "#2a2a2a",
  text: "#e6e6e6",
  textMuted: "#9a9a9a",
  textDim: "#5e5e5e",
  primary: "#d97757", // claude orange
  accent: "#7aa2f7",
  user: "#9ece6a",
  assistant: "#bb9af7",
  tool: "#7dcfff",
  toolMuted: "#3d6470",
  error: "#f7768e",
  warn: "#e0af68",
  success: "#9ece6a",
  thinking: "#7c7c7c",
}

const ThemeContext = createContext<Theme>(DARK_THEME)

export function ThemeProvider(props: { children: JSX.Element }) {
  return <ThemeContext.Provider value={DARK_THEME}>{props.children}</ThemeContext.Provider>
}

export function useTheme(): Theme {
  return useContext(ThemeContext)
}
