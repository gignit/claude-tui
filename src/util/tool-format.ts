/**
 * Per-tool input formatting for the scrollback's tool-call blocks.
 *
 * Each tool gets two views:
 *   - **headline** — a short, single-line summary shown next to the
 *     tool name in the collapsed (and expanded) header. e.g.
 *     `Read · auth/context_test.go (lines 1-200)`
 *   - **details** — a longer, multi-line block shown beneath the
 *     header when the tool is expanded. May be omitted if the headline
 *     already says everything (e.g. Read shows path + range and that's
 *     enough; Bash needs the full command in details).
 *
 * Adding a new tool: drop a new entry into FORMATTERS keyed by the
 * raw tool name. Return `{ headline?, details? }`. Anything you don't
 * register falls back to `defaultFormatter`, which is good enough that
 * unmapped tools still look reasonable.
 *
 * Display name handling: `displayToolName` strips the `mcp__server__`
 * prefix on MCP tools and shows them as `server/tool` (e.g.
 * `mcp__coder__go_function` becomes `coder/go_function`).
 */

export interface ToolFormatted {
  /** One-line summary shown next to the tool name. Truncated by the renderer. */
  headline?: string
  /** Multi-line detail shown when the tool block is expanded. */
  details?: string
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
 * Pretty-stringify a value for the details panel. Long strings stay
 * raw (they may be code/text); objects get JSON.stringify with indent.
 */
function pretty(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/**
 * Format a Read-style line range. Three cases:
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
      // Show the full command in expanded view, even when there's a
      // description — the description is the *intent*, not the action.
      details: cmd,
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
      details: content,
    }
  },
  Edit: (i) => {
    const path = String(i["file_path"] ?? "")
    const replaceAll = i["replace_all"] === true
    const oldStr = String(i["old_string"] ?? "")
    const newStr = String(i["new_string"] ?? "")
    return {
      headline: `${shortPath(path)}${replaceAll ? " (replace_all)" : ""}`,
      details: `--- old\n${oldStr}\n+++ new\n${newStr}`,
    }
  },

  // --- Search ------------------------------------------------------------
  Grep: (i) => {
    const pattern = String(i["pattern"] ?? "")
    const path = i["path"] ? ` in ${shortPath(String(i["path"]))}` : ""
    const glob = i["glob"] ? ` glob=${String(i["glob"])}` : ""
    const type = i["type"] ? ` type=${String(i["type"])}` : ""
    const mode = i["output_mode"] ? ` mode=${String(i["output_mode"])}` : ""
    return {
      headline: `/${pattern}/${path}${glob}${type}`,
      details: `pattern: ${pattern}${path}${glob}${type}${mode}` + (i["-i"] ? "  -i" : "") + (i["-n"] ? "  -n" : ""),
    }
  },
  Glob: (i) => {
    const pattern = String(i["pattern"] ?? "")
    const path = i["path"] ? ` in ${shortPath(String(i["path"]))}` : ""
    return { headline: `${pattern}${path}` }
  },

  // --- Tasks -------------------------------------------------------------
  TaskCreate: (i) => {
    const subject = String(i["subject"] ?? "")
    const description = String(i["description"] ?? "")
    const activeForm = String(i["activeForm"] ?? "")
    const detailLines = [`subject: ${subject}`]
    if (description) detailLines.push(`description: ${description}`)
    if (activeForm) detailLines.push(`activeForm: ${activeForm}`)
    return { headline: subject, details: detailLines.join("\n") }
  },
  TaskUpdate: (i) => {
    const id = String(i["taskId"] ?? "")
    const status = String(i["status"] ?? "")
    const subject = typeof i["subject"] === "string" ? ` ${(i["subject"] as string)}` : ""
    return {
      headline: `#${id} → ${status}${subject}`,
      // Useful when the update bundles other field changes.
      details: pretty(i),
    }
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
      details: prompt || pretty(i),
    }
  },
  Skill: (i) => {
    const skill = String(i["skill"] ?? "")
    const args = typeof i["args"] === "string" ? ` ${(i["args"] as string)}` : ""
    return { headline: `${skill}${args}` }
  },

  // --- Search-the-tool-list ---------------------------------------------
  ToolSearch: (i) => {
    const q = String(i["query"] ?? "")
    const max = i["max_results"]
    return {
      headline: `"${q}"${max !== undefined ? ` (max ${max})` : ""}`,
    }
  },

  // --- Web ---------------------------------------------------------------
  WebFetch: (i) => {
    const url = String(i["url"] ?? "")
    const prompt = String(i["prompt"] ?? "")
    return { headline: url, details: prompt ? `prompt: ${prompt}` : undefined }
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
    return {
      headline: `${shortPath(path)}${cellId}${cellType}${editMode}`,
      details: typeof i["new_source"] === "string" ? (i["new_source"] as string) : undefined,
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
  return { headline: segments.join("  "), details: pretty(input) }
}

// -----------------------------------------------------------------------------
// Default fallback
// -----------------------------------------------------------------------------

/**
 * Same idea as the MCP fallback: look for the first useful field
 * across a list of likely candidates. If nothing matches, fall back to
 * "(<n> args)" so the user at least knows the tool was called with
 * SOMETHING — better than printing `{`.
 */
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
      return { headline: `${key}=${compact(v)}`, details: pretty(input) }
    }
  }
  const argCount = Object.keys(input).length
  return {
    headline: argCount === 0 ? "(no args)" : `(${argCount} args)`,
    details: pretty(input),
  }
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
 * Helper: pretty JSON of an unknown input object. Used by the renderer
 * when a formatter doesn't supply `details`.
 */
export function fallbackInputJson(input: Record<string, unknown>): string {
  return pretty(input)
}
