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
  | ToolResultDisplayItem
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
  /** Pretty-printed JSON, ready to render verbatim. */
  inputJson: string
  /** Whether the result has arrived yet. */
  resolved: boolean
  createdAt: number
}

export interface ToolResultDisplayItem {
  kind: "tool_result"
  id: DisplayMessageId
  toolUseId: string
  /** Already-stringified output. May be very long. */
  output: string
  isError: boolean
  createdAt: number
}

export interface SystemNoticeDisplayItem {
  kind: "system"
  id: DisplayMessageId
  text: string
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
