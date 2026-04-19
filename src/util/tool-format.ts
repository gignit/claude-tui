/**
 * Per-tool input formatting for the scrollback's tool-call blocks.
 *
 * Each tool gets:
 *   - **headline** — short single-line summary shown next to the tool
 *     name in the collapsed (and expanded) header. e.g.
 *     `Read · auth/context_test.go (lines 1-200)`
 *   - **previews** (optional) — rich renderings for specific input
 *     attributes. Each preview "consumes" a list of input keys: those
 *     keys are EXCLUDED from the JSON view and the rich preview is
 *     rendered in their place after the JSON.
 *
 * Default expanded view is always pretty JSON of the input (minus any
 * attributes consumed by previews). This keeps the on-wire shape
 * visible (so the user can see exactly what the model sent) while
 * letting individual fields opt in to nicer rendering.
 *
 * Adding a new tool: drop a new entry into FORMATTERS keyed by the
 * raw tool name. Returning just `{ headline }` is fine — the JSON
 * view is the default expanded body. Return `previews` only when
 * a specific attribute reads better as code, a diff, etc.
 *
 * Display name handling: `displayToolName` strips the `mcp__server__`
 * prefix on MCP tools and shows them as `server/tool` (e.g.
 * `mcp__coder__go_function` becomes `coder/go_function`).
 */

/**
 * Rich preview kinds. The renderer in message.tsx pattern-matches on
 * `kind` to apply the right styling. Add new kinds here when you need
 * a new presentation (e.g. "table", "tree", "image").
 */
export type RichPreview =
  | {
      kind: "diff"
      /** Input attribute names this preview replaces in the JSON view. */
      attrs: string[]
      /** Optional caption shown above the diff. */
      label?: string
      before: string
      after: string
    }
  | {
      kind: "code"
      attrs: string[]
      label?: string
      content: string
      /** Hint for syntax highlighting (currently unused; reserved). */
      language?: string
    }

export interface ToolFormatted {
  /** One-line summary shown next to the tool name. Truncated by the renderer. */
  headline?: string
  /**
   * Optional rich rendering of specific input attributes. Each
   * preview's `attrs` are excluded from the JSON view and the
   * rendering shows after the JSON in the expanded body.
   */
  previews?: RichPreview[]
}

export type ToolFormatter = (input: Record<string, unknown>) => ToolFormatted

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Squash an absolute filesystem path into a tighter form. Keeps the
 * last two segments to retain disambiguating context (e.g.
 * `/home/x/proj/internal/auth/login.go` → `auth/login.go`).
 */
function shortPath(p: string): string {
  if (!p) return ""
  const parts = p.split("/").filter(Boolean)
  if (parts.length <= 2) return p
  return parts.slice(-2).join("/")
}

/** First non-empty line, trimmed. */
function firstLine(s: string): string {
  for (const line of s.split("\n")) {
    const trimmed = line.trim()
    if (trimmed) return trimmed
  }
  return ""
}

/** Compact whitespace + trim. Useful for headlines pulled from prose. */
function compact(s: string): string {
  return s.replace(/\s+/g, " ").trim()
}

/**
 * Format a Read-style line range for headlines. Three cases:
 *   - both offset and limit: `(lines 100-149)`
 *   - limit only:            `(first 50 lines)`
 *   - offset only:           `(from line 100)`
 *   - neither:               ""
 */
function rangeSuffix(input: Record<string, unknown>): string {
  const offset = typeof input["offset"] === "number" ? (input["offset"] as number) : undefined
  const limit = typeof input["limit"] === "number" ? (input["limit"] as number) : undefined
  if (offset !== undefined && limit !== undefined) {
    return ` (lines ${offset}-${offset + limit - 1})`
  }
  if (limit !== undefined) return ` (first ${limit} lines)`
  if (offset !== undefined) return ` (from line ${offset})`
  return ""
}

// -----------------------------------------------------------------------------
// Public name helper
// -----------------------------------------------------------------------------

/**
 * `mcp__coder__go_function` → `coder/go_function`.
 * Anything else returned unchanged.
 */
export function displayToolName(raw: string): string {
  const m = /^mcp__([^_]+(?:_[^_]+)*)__([^_].*)$/.exec(raw)
  if (m) return `${m[1]}/${m[2]}`
  return raw
}

// -----------------------------------------------------------------------------
// Formatters per known tool
// -----------------------------------------------------------------------------

const FORMATTERS: Record<string, ToolFormatter> = {
  // --- Bash --------------------------------------------------------------
  Bash: (i) => {
    const cmd = String(i["command"] ?? "")
    const desc = typeof i["description"] === "string" ? (i["description"] as string).trim() : ""
    return {
      // Description (when set by the model) is the short summary; fall
      // back to the first line of the command itself.
      headline: desc || compact(firstLine(cmd)),
    }
  },

  // --- File ops ----------------------------------------------------------
  Read: (i) => {
    const path = String(i["file_path"] ?? "")
    return { headline: shortPath(path) + rangeSuffix(i) }
  },
  Write: (i) => {
    const path = String(i["file_path"] ?? "")
    const content = String(i["content"] ?? "")
    const lineCount = content ? content.split("\n").length : 0
    const byteCount = content.length
    return {
      headline: `${shortPath(path)} (${lineCount} lines, ${byteCount} bytes)`,
      previews: [
        // Pull `content` out of the JSON view — it's almost always a
        // multi-line code blob and looks awful with literal \n.
        { kind: "code", attrs: ["content"], label: "content", content },
      ],
    }
  },
  Edit: (i) => {
    const path = String(i["file_path"] ?? "")
    const replaceAll = i["replace_all"] === true
    const oldStr = String(i["old_string"] ?? "")
    const newStr = String(i["new_string"] ?? "")
    return {
      headline: `${shortPath(path)}${replaceAll ? " (replace_all)" : ""}`,
      previews: [
        {
          kind: "diff",
          attrs: ["old_string", "new_string"],
          label: "diff",
          before: oldStr,
          after: newStr,
        },
      ],
    }
  },

  // --- Search ------------------------------------------------------------
  Grep: (i) => {
    const pattern = String(i["pattern"] ?? "")
    const path = i["path"] ? ` in ${shortPath(String(i["path"]))}` : ""
    return { headline: `/${pattern}/${path}` }
  },
  Glob: (i) => {
    const pattern = String(i["pattern"] ?? "")
    const path = i["path"] ? ` in ${shortPath(String(i["path"]))}` : ""
    return { headline: `${pattern}${path}` }
  },

  // --- Tasks -------------------------------------------------------------
  TaskCreate: (i) => ({ headline: String(i["subject"] ?? "") }),
  TaskUpdate: (i) => {
    const id = String(i["taskId"] ?? "")
    const status = String(i["status"] ?? "")
    const subject = typeof i["subject"] === "string" ? ` ${i["subject"] as string}` : ""
    return { headline: `#${id} → ${status}${subject}` }
  },
  TaskList: () => ({ headline: "(list all)" }),
  TaskGet: (i) => ({ headline: `#${String(i["taskId"] ?? "")}` }),
  TaskOutput: (i) => ({ headline: `#${String(i["taskId"] ?? "")}` }),
  TaskStop: (i) => ({ headline: `#${String(i["taskId"] ?? "")}` }),

  // --- Agent / Skill -----------------------------------------------------
  Task: (i) => {
    const subagent = i["subagent_type"] ? `${String(i["subagent_type"])}: ` : ""
    const desc = String(i["description"] ?? "")
    const prompt = String(i["prompt"] ?? "")
    return {
      headline: `${subagent}${desc}`,
      previews: prompt ? [{ kind: "code", attrs: ["prompt"], label: "prompt", content: prompt }] : [],
    }
  },
  Skill: (i) => {
    const skill = String(i["skill"] ?? "")
    const args = typeof i["args"] === "string" ? ` ${i["args"] as string}` : ""
    return { headline: `${skill}${args}` }
  },

  // --- Search-the-tool-list ---------------------------------------------
  ToolSearch: (i) => {
    const q = String(i["query"] ?? "")
    const max = i["max_results"]
    return { headline: `"${q}"${max !== undefined ? ` (max ${max})` : ""}` }
  },

  // --- Web ---------------------------------------------------------------
  WebFetch: (i) => {
    const url = String(i["url"] ?? "")
    return { headline: url }
  },
  WebSearch: (i) => {
    const q = String(i["query"] ?? "")
    return { headline: `"${q}"` }
  },

  // --- Notebooks ---------------------------------------------------------
  NotebookEdit: (i) => {
    const path = String(i["notebook_path"] ?? "")
    const cellId = i["cell_id"] ? ` cell=${String(i["cell_id"])}` : ""
    const cellType = i["cell_type"] ? ` (${String(i["cell_type"])})` : ""
    const editMode = i["edit_mode"] ? ` mode=${String(i["edit_mode"])}` : ""
    const newSource = typeof i["new_source"] === "string" ? (i["new_source"] as string) : ""
    return {
      headline: `${shortPath(path)}${cellId}${cellType}${editMode}`,
      previews: newSource
        ? [{ kind: "code", attrs: ["new_source"], label: "new source", content: newSource }]
        : [],
    }
  },

  // --- Plan / worktree (no useful args) ---------------------------------
  EnterPlanMode: () => ({ headline: "enter plan mode" }),
  ExitPlanMode: () => ({ headline: "exit plan mode" }),
  EnterWorktree: (i) => ({ headline: `worktree: ${shortPath(String(i["path"] ?? ""))}` }),
  ExitWorktree: () => ({ headline: "exit worktree" }),

  // --- AskUserQuestion --------------------------------------------------
  AskUserQuestion: (i) => {
    const qs = Array.isArray(i["questions"]) ? (i["questions"] as Array<{ question?: string }>) : []
    const first = qs[0]?.question ?? ""
    const rest = qs.length > 1 ? ` (+${qs.length - 1} more)` : ""
    return { headline: `${compact(first)}${rest}` }
  },
}

// -----------------------------------------------------------------------------
// MCP fallback — picks the most useful field automatically
// -----------------------------------------------------------------------------

/**
 * For an unrecognised MCP tool (`mcp__server__tool`), surface whichever
 * input field is the most informative. The order below reflects the
 * common MCP conventions across coder, chrome-devtools, etc.
 */
const MCP_HEADLINE_KEYS = [
  "selector",
  "query",
  "url",
  "name",
  "module",
  "file",
  "dir",
  "path",
  "cwd",
  "id",
  "command",
]

function mcpFormatter(input: Record<string, unknown>): ToolFormatted {
  const segments: string[] = []
  for (const key of MCP_HEADLINE_KEYS) {
    const v = input[key]
    if (typeof v === "string" && v.length > 0) {
      segments.push(`${key}=${v}`)
      if (segments.length >= 2) break
    }
  }
  return { headline: segments.join("  ") }
}

// -----------------------------------------------------------------------------
// Default fallback
// -----------------------------------------------------------------------------

const DEFAULT_HEADLINE_KEYS = [
  "command",
  "description",
  "name",
  "title",
  "subject",
  "query",
  "pattern",
  "url",
  "path",
  "file_path",
  "id",
  "selector",
]

function defaultFormatter(input: Record<string, unknown>): ToolFormatted {
  for (const key of DEFAULT_HEADLINE_KEYS) {
    const v = input[key]
    if (typeof v === "string" && v.length > 0) {
      return { headline: `${key}=${compact(v)}` }
    }
  }
  const argCount = Object.keys(input).length
  return { headline: argCount === 0 ? "(no args)" : `(${argCount} args)` }
}

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------

/**
 * Format a tool call for display. Always returns something usable:
 *   1. Registered formatter for the exact tool name → use it.
 *   2. mcp__... tool → MCP fallback.
 *   3. Otherwise → JSON-style fallback.
 */
export function formatToolInput(toolName: string, input: Record<string, unknown>): ToolFormatted {
  const fn = FORMATTERS[toolName]
  if (fn) return fn(input)
  if (toolName.startsWith("mcp__")) return mcpFormatter(input)
  return defaultFormatter(input)
}

/**
 * Pretty-print the input object for the expanded view, OMITTING the
 * keys consumed by previews. Returns "{}" when nothing is left.
 */
export function jsonExcluding(input: Record<string, unknown>, excluded: ReadonlySet<string>): string {
  const filtered: Record<string, unknown> = {}
  let count = 0
  for (const [k, v] of Object.entries(input)) {
    if (excluded.has(k)) continue
    filtered[k] = v
    count++
  }
  if (count === 0) return "{}"
  try {
    return JSON.stringify(filtered, null, 2)
  } catch {
    return String(filtered)
  }
}
