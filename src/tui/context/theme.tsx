/**
 * Theme system.
 *
 * The Theme object exposes two layers:
 *
 *   1. **UI palette** — flat color roles used directly by components
 *      (`background`, `text`, `primary`, `accent`, `tool`, etc.). These
 *      are hex strings consumed by opentui's `<text fg=…>` etc.
 *
 *   2. **Markdown palette** — color roles tied to markdown elements
 *      (heading, bold, italic, inline code, link, list bullet, table,
 *      blockquote, rule). Stored as plain hex strings on the Theme
 *      object so a future "switch theme" command can swap them in
 *      reactively.
 *
 * `useTheme()` returns:
 *   - the live `Theme` object
 *   - a derived `markdownStyle: SyntaxStyle` ready to pass to opentui's
 *     `<markdown syntaxStyle={…} />`. Built once per theme via
 *     SyntaxStyle.fromStyles, mapping our markdown palette to the
 *     TextMate scopes the markdown renderer queries
 *     (`markup.heading`, `markup.strong`, `markup.italic`,
 *     `markup.strikethrough`, `markup.raw`, `markup.link`,
 *     `markup.link.label`, `markup.link.url`, `default`, `conceal`).
 *
 * Adding a new theme: define another `Theme` object and pass it to
 * <ThemeProvider theme={...}>. Default is DARK_THEME; we currently only
 * have one but the structure leaves room.
 */

import { createContext, createMemo, useContext, type JSX } from "solid-js"
import { RGBA, SyntaxStyle, type ColorInput, type StyleDefinition } from "@opentui/core"

export interface MarkdownPalette {
  /** # / ## / ### headings (flat across levels — opentui only exposes one scope). */
  heading: string
  /** **bold** content. We default to text + bold attribute to stay readable. */
  bold: string
  /** *italic* content. */
  italic: string
  /** ~~strikethrough~~ content. */
  strike: string
  /** `inline code` — distinct color so it stands out in prose. */
  inlineCode: string
  /** Optional background highlight behind inline code. */
  inlineCodeBg?: string
  /** Underlined http://... URLs. */
  link: string
  /** Visible label of [...](...) links. */
  linkText: string
  /** > blockquote text — usually muted + italic. */
  blockquote: string
  /** Horizontal rule color. */
  rule: string
  /** Bullet character for - * + lists. */
  listBullet: string
  /** Number for 1. 2. 3. ordered lists. */
  listNumber: string
  /** Table header cells (bold). */
  tableHeader: string
  /** Table grid lines. */
  tableBorder: string
}

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
  markdown: MarkdownPalette
}

/**
 * Default theme — dark with a warm-orange accent (Claude brand) and a
 * cool-blue secondary. The markdown palette extends the same roles:
 *   - structural elements (headings, links) lean cool/blue.
 *   - emphasis (bold) stays in the text color so it doesn't reinterpret
 *     the author's intent as a color signal.
 *   - code uses the cyan tool color, matching how tool blocks are
 *     attributed elsewhere — keeps "this is code" visually consistent.
 *   - lists, tables, and rules use the existing border/accent palette
 *     so structure feels integrated rather than bolted on.
 */
export const DARK_THEME: Theme = {
  background: "#0a0a0a",
  backgroundPanel: "#141414",
  backgroundElement: "#1f1f1f",
  border: "#2a2a2a",
  text: "#e6e6e6",
  textMuted: "#9a9a9a",
  textDim: "#5e5e5e",
  primary: "#d97757",
  accent: "#7aa2f7",
  user: "#9ece6a",
  assistant: "#bb9af7",
  tool: "#7dcfff",
  toolMuted: "#3d6470",
  error: "#f7768e",
  warn: "#e0af68",
  success: "#9ece6a",
  thinking: "#7c7c7c",
  markdown: {
    heading: "#7aa2f7", // accent — cool, distinct from body text
    bold: "#e6e6e6", // body text + bold attribute
    italic: "#c2c2c2", // slightly dim + italic attribute
    strike: "#5e5e5e", // dim
    inlineCode: "#7dcfff", // cyan, matches tool attribution
    inlineCodeBg: "#1f1f1f", // subtle bg highlight on inline code
    link: "#7aa2f7", // accent
    linkText: "#7dcfff", // cyan label
    blockquote: "#9a9a9a", // muted + italic attribute
    rule: "#2a2a2a", // border color
    listBullet: "#d97757", // primary orange — pops against text
    listNumber: "#7aa2f7", // accent blue
    tableHeader: "#7aa2f7", // accent blue, bold
    tableBorder: "#2a2a2a", // border
  },
}

/**
 * Build a SyntaxStyle from the theme's markdown palette. Maps our role
 * names to the TextMate-style scopes opentui's markdown renderer queries.
 *
 * The "conceal" scope is special: opentui uses it to hide markdown
 * source markers (e.g. the `**` around bold text) when `conceal: true`
 * is set on the <markdown> element. We map it to the background color
 * so the markers fade out without affecting layout.
 */
function buildMarkdownSyntaxStyle(theme: Theme): SyntaxStyle {
  const md = theme.markdown
  const styles: Record<string, StyleDefinition> = {
    default: defStyle({ fg: theme.text }),
    conceal: defStyle({ fg: theme.background, dim: true }),
    "markup.heading": defStyle({ fg: md.heading, bold: true }),
    "markup.strong": defStyle({ fg: md.bold, bold: true }),
    "markup.italic": defStyle({ fg: md.italic, italic: true }),
    "markup.strikethrough": defStyle({ fg: md.strike }),
    "markup.raw": defStyle({ fg: md.inlineCode, ...(md.inlineCodeBg ? { bg: md.inlineCodeBg } : {}) }),
    "markup.link": defStyle({ fg: md.link, underline: true }),
    "markup.link.label": defStyle({ fg: md.linkText }),
    "markup.link.url": defStyle({ fg: md.link, underline: true }),
  }
  return SyntaxStyle.fromStyles(styles)
}

/** Adapter: hex/RGBA inputs from theme → opentui StyleDefinition with RGBA. */
function defStyle(input: {
  fg?: ColorInput
  bg?: ColorInput
  bold?: boolean
  italic?: boolean
  underline?: boolean
  dim?: boolean
}): StyleDefinition {
  const out: StyleDefinition = {}
  if (input.fg !== undefined) out.fg = toRgba(input.fg)
  if (input.bg !== undefined) out.bg = toRgba(input.bg)
  if (input.bold) out.bold = true
  if (input.italic) out.italic = true
  if (input.underline) out.underline = true
  if (input.dim) out.dim = true
  return out
}

function toRgba(c: ColorInput): RGBA {
  if (typeof c === "string") return RGBA.fromHex(c)
  // Already an RGBA — pass through.
  return c as RGBA
}

export interface ThemeContextValue {
  theme: Theme
  /** Pre-built SyntaxStyle for opentui's <markdown> element. */
  markdownStyle: SyntaxStyle
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export interface ThemeProviderProps {
  children: JSX.Element
  /** Override the theme. Defaults to DARK_THEME. */
  theme?: Theme
}

export function ThemeProvider(props: ThemeProviderProps) {
  // Memo so SyntaxStyle is built once per theme switch (not per render).
  const value = createMemo<ThemeContextValue>(() => {
    const theme = props.theme ?? DARK_THEME
    return { theme, markdownStyle: buildMarkdownSyntaxStyle(theme) }
  })
  return <ThemeContext.Provider value={value()}>{props.children}</ThemeContext.Provider>
}

/**
 * Returns the live Theme object. Backwards-compatible: existing
 * callsites still get the flat color palette via `useTheme().<role>`.
 * The markdown SyntaxStyle is also accessible via `useTheme().markdown`
 * — wait, no: `useTheme()` returns the Theme directly. To access the
 * SyntaxStyle, use `useThemeContext().markdownStyle`.
 *
 * (We keep the two-level API to avoid breaking every existing
 * `useTheme().background` call.)
 */
export function useTheme(): Theme {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme() called outside <ThemeProvider>")
  return ctx.theme
}

/** Full context value (theme + derived SyntaxStyle). */
export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useThemeContext() called outside <ThemeProvider>")
  return ctx
}
