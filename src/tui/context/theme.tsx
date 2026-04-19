/**
 * Theme system.
 *
 * The Theme object exposes three layers:
 *
 *   1. **UI palette** — flat color roles used directly by components
 *      (`background`, `text`, `primary`, `accent`, `tool`, etc.). These
 *      are hex strings consumed by opentui's `<text fg=…>` etc.
 *
 *   2. **Markdown palette** — color roles tied to markdown elements
 *      (heading, bold, italic, inline code, link, list bullet, table,
 *      blockquote, rule). Stored as plain hex strings on the Theme so
 *      a future "switch theme" command can swap them in reactively.
 *
 *   3. **Syntax palette** — color roles tied to *code* tokens that
 *      tree-sitter emits when highlighting fenced code blocks (and the
 *      embedded markdown grammar). Without these, headings, list
 *      bullets, horizontal rules, and language-tagged code fences all
 *      render as undifferentiated body text — opentui delegates those
 *      to a CodeRenderable with `filetype: "markdown"` whose default
 *      style is `default` (= our text color) unless the syntax style
 *      registers `markup.heading.N`, `markup.list`, etc. The same
 *      registry is also what colors `keyword`, `string`, `function`
 *      inside ```ts ... ``` blocks.
 *
 * `useTheme()` returns:
 *   - the live `Theme` object (flat UI palette + nested groups).
 * `useThemeContext()` additionally returns:
 *   - `syntaxStyle: SyntaxStyle` — the merged opentui style table
 *     consumed by `<markdown syntaxStyle={…} />` and `<code …>`.
 *   - `treeSitterClient: TreeSitterClient` — the singleton client used
 *     to actually compute highlights for both markdown and fenced code.
 *
 * Adding a new theme: define another `Theme` object and pass it to
 * <ThemeProvider theme={...}>. Default is DARK_THEME; we currently only
 * have one but the structure leaves room.
 */

import { createContext, createMemo, useContext, type JSX } from "solid-js"
import {
  RGBA,
  SyntaxStyle,
  type ColorInput,
  type ThemeTokenStyle,
} from "@opentui/core"
import { getTreeSitterClient, type TreeSitterClient } from "@opentui/core"

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
  /** Default foreground for fenced code block content (when no token-level
   *  highlight wins). Lighter / dimmer than body text helps the code feel
   *  like a separate region. */
  codeBlock: string
}

/**
 * Code-syntax color roles. These map onto the token classes tree-sitter
 * grammars emit (`comment`, `string`, `keyword`, `function`, …). The same
 * names are reused inside the markdown grammar for `markup.heading`,
 * `markup.list`, etc., so the SyntaxStyle is one shared registry.
 */
export interface SyntaxPalette {
  /** // and /* … *\/ */
  comment: string
  /** "string literals", 'single quoted', `template`. */
  string: string
  /** 42, 3.14, 0x1f */
  number: string
  /** if / else / return / async / fn / let / const … */
  keyword: string
  /** type names — User, string, int. */
  type: string
  /** function / method names. */
  function: string
  /** + - * / && || === */
  operator: string
  /** identifier names (variables, parameters). */
  variable: string
  /** ( ) { } [ ] , ; */
  punctuation: string
  /** Builtins (true, false, null, undefined, console, …). */
  builtin: string
  /** Tag names in HTML/JSX. */
  tag: string
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
  syntax: SyntaxPalette
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
 *
 * Syntax palette is a measured Tokyonight-ish set chosen to read well
 * against the panel background:
 *   - blue-violet for keywords, cyan for types, soft-blue for functions
 *   - green for strings (the calmest scope visually)
 *   - orange for numbers and constants (matches the Claude primary)
 *   - dim grey for comments and punctuation so the eye lands on
 *     structurally meaningful tokens first.
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
    rule: "#3a3a3a", // a touch brighter than `border` so it's actually visible
    listBullet: "#d97757", // primary orange — pops against text
    listNumber: "#7aa2f7", // accent blue
    tableHeader: "#7aa2f7", // accent blue, bold
    tableBorder: "#2a2a2a", // border
    codeBlock: "#c0c0c0", // slightly cooler than text — code reads as "set apart"
  },
  syntax: {
    comment: "#5e5e5e", // dim — out of the way
    string: "#9ece6a", // green — calm
    number: "#ff9e64", // soft orange — close to Claude primary
    keyword: "#bb9af7", // violet — same family as assistant accent
    type: "#7dcfff", // cyan — pairs with inlineCode
    function: "#7aa2f7", // accent blue
    operator: "#89ddff", // pale cyan
    variable: "#e6e6e6", // body text — variables are the "default" identifier
    punctuation: "#7c7c7c", // dim grey — present but not loud
    builtin: "#f7768e", // pinkish red — true/false/null/console
    tag: "#f7768e", // same as builtin
  },
}

/**
 * Build a SyntaxStyle covering both markdown structure and code tokens.
 *
 * Why one shared registry: opentui's `<markdown>` element delegates
 * heading / list / horizontal-rule / code-fence rendering to an internal
 * `CodeRenderable` with `filetype: "markdown"`. That renderable asks
 * tree-sitter (via the bundled markdown grammar) for highlight ranges
 * tagged with TextMate-ish scope names like `markup.heading.1`,
 * `markup.list`, `punctuation.special`, etc. The SAME renderable is
 * also used by fenced code blocks (` ```ts … ``` ` → `filetype:
 * "typescript"`), where tree-sitter emits scopes like `keyword`,
 * `string`, `function`. Mapping both sets here means one registry
 * styles everything from headings to code.
 *
 * The "conceal" scope is special: opentui uses it to hide markdown
 * source markers (e.g. the `**` around bold text, `# ` before headings,
 * the language hint after ` ``` `) when `conceal: true` / `concealCode:
 * true` is set on the `<markdown>` element. We map it to the background
 * color + dim so the markers fade out without disturbing layout.
 */
function buildSyntaxStyle(theme: Theme): SyntaxStyle {
  const md = theme.markdown
  const sx = theme.syntax
  // ThemeTokenStyle is the array form of the opentui registry: each
  // entry binds one or more scopes to a single style. The renderer
  // resolves a token's scope by walking the longest-match prefix —
  // `markup.heading.1` will use a `markup.heading.1` style if defined,
  // otherwise it falls through to `markup.heading`, then `default`.
  const rules: ThemeTokenStyle[] = [
    // Default body text — applies to anything without a more specific
    // scope (paragraph prose, list item content, etc).
    { scope: ["default"], style: { foreground: theme.text } },
    // Markdown source markers (`**`, `_`, leading `#`, fence backticks)
    // when conceal is on. background+dim makes them invisible without
    // changing the cell width.
    { scope: ["conceal"], style: { foreground: theme.background, dim: true } },

    // ─── Markdown structure ───────────────────────────────────────────
    // Generic + per-level. tree-sitter sometimes emits the leveled
    // form (`markup.heading.1`); we map all six to the same style so
    // levels look consistent rather than introducing a size hierarchy
    // that doesn't really translate to a terminal.
    { scope: ["markup.heading"], style: { foreground: md.heading, bold: true } },
    { scope: ["markup.heading.1"], style: { foreground: md.heading, bold: true } },
    { scope: ["markup.heading.2"], style: { foreground: md.heading, bold: true } },
    { scope: ["markup.heading.3"], style: { foreground: md.heading, bold: true } },
    { scope: ["markup.heading.4"], style: { foreground: md.heading, bold: true } },
    { scope: ["markup.heading.5"], style: { foreground: md.heading, bold: true } },
    { scope: ["markup.heading.6"], style: { foreground: md.heading, bold: true } },
    {
      scope: ["markup.bold", "markup.strong"],
      style: { foreground: md.bold, bold: true },
    },
    { scope: ["markup.italic"], style: { foreground: md.italic, italic: true } },
    { scope: ["markup.strikethrough"], style: { foreground: md.strike } },
    { scope: ["markup.list"], style: { foreground: md.listBullet } },
    {
      scope: ["markup.list.checked"],
      style: { foreground: theme.success },
    },
    {
      scope: ["markup.list.unchecked"],
      style: { foreground: theme.textMuted },
    },
    {
      scope: ["markup.quote"],
      style: { foreground: md.blockquote, italic: true },
    },
    // Inline `code` — set a background to make it pop the way GitHub
    // inline code does. The block variants don't get a background; they
    // already live inside a CodeRenderable with its own `fg`.
    {
      scope: ["markup.raw.inline"],
      style: {
        foreground: md.inlineCode,
        ...(md.inlineCodeBg ? { background: md.inlineCodeBg } : {}),
      },
    },
    {
      scope: ["markup.raw", "markup.raw.block"],
      style: { foreground: md.inlineCode },
    },
    {
      scope: ["markup.link"],
      style: { foreground: md.link, underline: true },
    },
    { scope: ["markup.link.label"], style: { foreground: md.linkText } },
    {
      scope: ["markup.link.url"],
      style: { foreground: md.link, underline: true },
    },

    // ─── Code-syntax scopes (tree-sitter's standard token class set) ──
    { scope: ["comment", "comment.documentation"], style: { foreground: sx.comment, italic: true } },
    { scope: ["string", "symbol", "character"], style: { foreground: sx.string } },
    { scope: ["string.escape", "string.regexp"], style: { foreground: sx.keyword } },
    { scope: ["number", "boolean", "float", "constant"], style: { foreground: sx.number } },
    {
      scope: ["keyword", "keyword.return", "keyword.conditional", "keyword.repeat", "keyword.import", "keyword.export", "keyword.exception", "keyword.modifier"],
      style: { foreground: sx.keyword, italic: true },
    },
    { scope: ["keyword.function"], style: { foreground: sx.function } },
    {
      scope: ["keyword.type", "type", "type.definition", "type.builtin", "module"],
      style: { foreground: sx.type },
    },
    { scope: ["function", "function.call", "function.method", "function.method.call", "constructor"], style: { foreground: sx.function } },
    {
      scope: ["operator", "keyword.operator", "punctuation.delimiter", "keyword.conditional.ternary"],
      style: { foreground: sx.operator },
    },
    { scope: ["variable", "variable.parameter", "variable.member", "parameter", "property", "field"], style: { foreground: sx.variable } },
    { scope: ["punctuation", "punctuation.bracket", "punctuation.special"], style: { foreground: sx.punctuation } },
    {
      scope: ["variable.builtin", "function.builtin", "constant.builtin", "module.builtin", "variable.super"],
      style: { foreground: sx.builtin },
    },
    { scope: ["class", "namespace"], style: { foreground: sx.type } },
    { scope: ["tag", "tag.attribute"], style: { foreground: sx.tag } },
    { scope: ["tag.delimiter"], style: { foreground: sx.operator } },
    { scope: ["attribute", "annotation"], style: { foreground: theme.warn } },
    { scope: ["label"], style: { foreground: md.linkText } },
  ]
  return SyntaxStyle.fromTheme(toRgbaTheme(rules))
}

/** Convert hex strings on a ThemeTokenStyle[] to RGBA so opentui can use them. */
function toRgbaTheme(rules: ThemeTokenStyle[]): ThemeTokenStyle[] {
  return rules.map((r) => ({
    scope: r.scope,
    style: {
      ...(r.style.foreground !== undefined ? { foreground: toRgba(r.style.foreground) } : {}),
      ...(r.style.background !== undefined ? { background: toRgba(r.style.background) } : {}),
      ...(r.style.bold ? { bold: true } : {}),
      ...(r.style.italic ? { italic: true } : {}),
      ...(r.style.underline ? { underline: true } : {}),
      ...(r.style.dim ? { dim: true } : {}),
    },
  }))
}

function toRgba(c: ColorInput): RGBA {
  if (typeof c === "string") return RGBA.fromHex(c)
  return c as RGBA
}

export interface ThemeContextValue {
  theme: Theme
  /** Pre-built SyntaxStyle for opentui's <markdown> and <code> elements. */
  syntaxStyle: SyntaxStyle
  /**
   * Singleton tree-sitter client. Cheap to grab — opentui memoizes it,
   * so calling getTreeSitterClient() multiple times returns the same
   * worker. Threading it through the context lets callsites pass it to
   * `<markdown treeSitterClient={…} />` without having to import opentui
   * directly. (Only `<markdown>` needs the explicit prop; `<code>`
   * auto-falls-back to the singleton via opentui's CodeRenderable
   * constructor.)
   */
  treeSitterClient: TreeSitterClient
  /**
   * Backwards-compat alias for the old `markdownStyle` field. Same
   * SyntaxStyle as `syntaxStyle` — kept under both names while we
   * migrate consumers.
   */
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
    const syntaxStyle = buildSyntaxStyle(theme)
    // getTreeSitterClient() is itself memoized (singleton) — calling it
    // multiple times just returns the same worker-backed client.
    const treeSitterClient = getTreeSitterClient()
    return {
      theme,
      syntaxStyle,
      treeSitterClient,
      markdownStyle: syntaxStyle,
    }
  })
  return <ThemeContext.Provider value={value()}>{props.children}</ThemeContext.Provider>
}

/**
 * Returns the live Theme object. Backwards-compatible: existing
 * callsites still get the flat color palette via `useTheme().<role>`.
 */
export function useTheme(): Theme {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme() called outside <ThemeProvider>")
  return ctx.theme
}

/** Full context value (theme + derived SyntaxStyle + TS client). */
export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useThemeContext() called outside <ThemeProvider>")
  return ctx
}
