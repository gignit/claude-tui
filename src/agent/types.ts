/**
 * Display-layer message types. The TUI only knows about these — it never
 * touches the SDK's wire types directly. The translation lives in client.ts.
 */

export type DisplayMessageId = string

/** Common discriminated-union base for items shown in the scrollback. */
export type DisplayItem =
  | UserDisplayMessage
  | AssistantDisplayMessage
  | ToolCallDisplayItem
  | SystemNoticeDisplayItem
  | ErrorDisplayItem

export interface UserDisplayMessage {
  kind: "user"
  id: DisplayMessageId
  text: string
  createdAt: number
}

export interface AssistantDisplayMessage {
  kind: "assistant"
  id: DisplayMessageId
  /**
   * Streaming text accumulator. The TUI re-renders as this grows.
   * Final once `complete` is true.
   */
  text: string
  thinking?: string
  complete: boolean
  /**
   * Model that produced this specific message — taken from
   * `BetaMessage.model` on the SDK assistant event. Stored per-message so
   * a mid-session `/model` switch never retroactively relabels older
   * responses (each one keeps the model that actually generated it).
   */
  model?: string
  /**
   * Agent mode (Default / Plan) that was active when this turn was
   * generated. Stored per-message for the same reason as `model`: a Tab
   * mid-conversation should never relabel earlier bubbles.
   */
  mode?: import("./modes.ts").AgentMode
  createdAt: number
}

export interface ToolCallDisplayItem {
  kind: "tool_call"
  id: DisplayMessageId
  /** Maps to SDK toolUseID so we can join with the result later. */
  toolUseId: string
  toolName: string
  /**
   * Parsed input object as the tool received it. The renderer hands
   * this to the per-tool formatter to produce a nice headline + details
   * (see src/util/tool-format.ts). Fallback: stringify on the fly.
   */
  input: Record<string, unknown>
  /** Whether the result has arrived yet. */
  resolved: boolean
  /**
   * Result text + error flag, populated when the tool's matching
   * tool_result block arrives (live SDK or JSONL replay). The result is
   * rendered inline beneath the call header so the visual pair stays
   * together — even when multiple parallel tools interleave on the wire.
   */
  result?: { output: string; isError: boolean }
  createdAt: number
}

export interface SystemNoticeDisplayItem {
  kind: "system"
  id: DisplayMessageId
  text: string
  /**
   * Visual weight for the notice.
   *   - "info" (default for user-facing notices like /help, /scroll)
   *     — body text color, easy to read.
   *   - "debug" — dim grey; used for SDK subprocess stderr in --debug
   *     mode where the content is technical and the user is scanning,
   *     not reading.
   * Default in the renderer is "debug" so legacy callsites that don't
   * pass a tone keep their previous look.
   */
  tone?: "info" | "debug"
  createdAt: number
}

export interface ErrorDisplayItem {
  kind: "error"
  id: DisplayMessageId
  text: string
  createdAt: number
}

/** Lightweight slice of the SDK's getContextUsage() response that the
 * status line cares about. Avoids exposing the full SDK shape. */
export interface ContextUsage {
  totalTokens: number
  maxTokens: number
  /** 0..100 from the SDK. */
  percentage: number
}

/** High-level events the agent client emits to the TUI. */
export type AgentEvent =
  | { type: "appended"; item: DisplayItem }
  | { type: "updated"; id: DisplayMessageId; patch: Partial<DisplayItem> }
  | { type: "status"; status: AgentStatus }
  | { type: "permission"; request: PermissionRequest }
  | { type: "question"; request: QuestionRequest }
  | { type: "model"; model: string }
  | { type: "mode"; mode: import("./modes.ts").AgentMode }
  | { type: "session"; sessionId: string }
  | { type: "context"; usage: ContextUsage }

export type AgentStatus =
  | { kind: "idle" }
  | { kind: "thinking" }
  | { kind: "streaming" }
  | { kind: "tool_running"; toolName: string }
  | { kind: "error"; message: string }

export interface PermissionRequest {
  toolName: string
  input: Record<string, unknown>
  title?: string
  description?: string
  toolUseId: string
  resolve: (allow: boolean) => void
}

/**
 * One option within an AskUserQuestion question.
 *
 * Mirrors the shape the SDK gives us in `tool_use.input.questions[].options[]`.
 * `preview` is filled when the host opts into `toolConfig.askUserQuestion.previewFormat`
 * (we don't, currently — left here for future use).
 */
export interface AskUserQuestionOption {
  label: string
  description: string
  preview?: string
}

/**
 * One question in an AskUserQuestion tool call. The SDK can deliver
 * 1–4 of these in a single tool_use.
 */
export interface AskUserQuestionItem {
  /** Full question text (e.g., "Which library should we use for date formatting?"). */
  question: string
  /** Short tag/header (max 12 chars per the SDK schema). */
  header: string
  /** 2–4 mutually-exclusive choices Claude generated. */
  options: AskUserQuestionOption[]
  /** When true, the user can pick more than one option. */
  multiSelect: boolean
}

/**
 * In-flight AskUserQuestion request. Created in agent/client.ts when
 * the SDK calls `canUseTool` with `toolName === "AskUserQuestion"`,
 * surfaced to the UI via the agent context, resolved when the user
 * picks options in the question dialog.
 *
 * `resolve` takes either:
 *   - a `Record<question, label-or-text>` map of answers per the
 *     SDK's expected output shape, or
 *   - `null` to cancel (treated as a denial — the underlying tool
 *     call gets `{behavior: "deny"}`).
 *
 * The keys of `answers` MUST be the exact `question` strings from
 * the request; the SDK matches answers to questions by key.
 * For multiSelect questions, join multiple labels with `", "`.
 * For "Other" / free-text input, use the typed string directly.
 */
export interface QuestionRequest {
  questions: AskUserQuestionItem[]
  toolUseId: string
  resolve: (answers: Record<string, string> | null) => void
}
