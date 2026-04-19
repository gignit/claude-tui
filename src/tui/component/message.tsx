/**
 * Renders one DisplayItem in the scrollback. Splits per-kind so each block
 * style stays isolated. Tool-call/result blocks honor the global expand
 * state (Ctrl+O) and collapse to a one-line summary when shrunk.
 */

import { For, Show, createMemo } from "solid-js"
import { useTheme } from "../context/theme.tsx"
import { useExpand } from "../context/expand.tsx"
import { modeLabel } from "../../agent/modes.ts"
import {
  displayToolName,
  formatToolInput,
  jsonExcluding,
  type RichPreview,
} from "../../util/tool-format.ts"
import { lineDiff } from "../../util/diff.ts"
import type {
  AssistantDisplayMessage,
  DisplayItem,
  ErrorDisplayItem,
  SystemNoticeDisplayItem,
  ToolCallDisplayItem,
  ToolResultDisplayItem,
  UserDisplayMessage,
} from "../../agent/types.ts"

const COLLAPSED_LINE_LIMIT = 3

export function MessageView(props: { item: DisplayItem }) {
  switch (props.item.kind) {
    case "user":
      return <UserBubble msg={props.item} />
    case "assistant":
      return <AssistantBubble msg={props.item} />
    case "tool_call":
      return <ToolCallBlock item={props.item} />
    case "tool_result":
      return <ToolResultBlock item={props.item} />
    case "system":
      return <SystemNotice item={props.item} />
    case "error":
      return <ErrorNotice item={props.item} />
  }
}

function UserBubble(props: { msg: UserDisplayMessage }) {
  const theme = useTheme()
  // No "you" label — the green left-border is the speaker indicator.
  return (
    <box marginTop={1} flexShrink={0}>
      <box paddingLeft={2} borderColor={theme.user} border={["left"]}>
        <text fg={theme.text}>{props.msg.text}</text>
      </box>
    </box>
  )
}

function AssistantBubble(props: { msg: AssistantDisplayMessage }) {
  const theme = useTheme()
  // No "claude" label — the purple left-border is the speaker indicator.
  // While streaming we append a dim "..." after the text so the user can
  // tell the turn isn't done yet. Once complete, we stamp the model that
  // produced this specific response so a mid-session /model switch never
  // retroactively relabels older bubbles.
  return (
    <box marginTop={1} flexShrink={0}>
      <box paddingLeft={2} borderColor={theme.assistant} border={["left"]}>
        <Show when={props.msg.thinking}>
          <text fg={theme.thinking}>{prefix("thinking: ", props.msg.thinking ?? "")}</text>
        </Show>
        <Show when={props.msg.text}>
          <text fg={theme.text}>{props.msg.text}</text>
        </Show>
        <Show when={!props.msg.complete}>
          <text fg={theme.thinking}>{"..."}</text>
        </Show>
        <Show when={props.msg.complete && (props.msg.model || props.msg.mode)}>
          {(() => {
            const parts: string[] = []
            if (props.msg.mode) parts.push(modeLabel(props.msg.mode))
            if (props.msg.model) parts.push(props.msg.model)
            return <text fg={theme.textDim}>{parts.join(" • ")}</text>
          })()}
        </Show>
      </box>
    </box>
  )
}

// Max characters of headline shown next to the tool name. Long inputs
// (e.g. very long Bash commands) get truncated here and shown in full
// when the user clicks to expand.
const HEADLINE_MAX = 80

function ToolCallBlock(props: { item: ToolCallDisplayItem }) {
  const theme = useTheme()
  const expand = useExpand()
  // Click handler flips this specific tool's per-tool override. Both
  // the call and the result share the same `toolUseId` so they stay
  // visually in sync — clicking either side flips both.
  const onClick = () => expand.toggleOne(props.item.toolUseId)
  const isExpanded = () => expand.isExpanded(props.item.toolUseId)
  // Per-tool formatter: returns a headline + zero-or-more rich previews.
  // displayToolName strips the mcp__ prefix into a friendlier "server/tool".
  const formatted = createMemo(() => formatToolInput(props.item.toolName, props.item.input))
  const niceName = () => displayToolName(props.item.toolName)
  const header = () => {
    const head = formatted().headline
    const headlinePart = head ? "  ·  " + truncateLine(head, HEADLINE_MAX) : ""
    return "  " + niceName() + headlinePart + (props.item.resolved ? "" : " ...")
  }
  // Keys consumed by previews are excluded from the JSON view (the
  // preview re-renders them in a richer way).
  const previews = () => formatted().previews ?? []
  const consumedAttrs = createMemo(
    () => new Set(previews().flatMap((p) => p.attrs)),
  )
  const jsonBody = () => jsonExcluding(props.item.input, consumedAttrs())
  return (
    <box
      marginTop={1}
      flexShrink={0}
      paddingLeft={1}
      borderColor={theme.tool}
      border={["left"]}
      onMouseUp={onClick}
    >
      <text fg={theme.tool}>{header()}</text>
      <Show when={isExpanded()}>
        <box flexDirection="column" gap={1}>
          {/* Always show the JSON of the input, minus consumed keys. */}
          <text fg={theme.toolMuted}>{jsonBody()}</text>
          {/* Then render each rich preview for the consumed keys. */}
          <For each={previews()}>{(p) => <ToolPreview preview={p} />}</For>
        </box>
      </Show>
    </box>
  )
}

/**
 * Renders one RichPreview from a tool formatter. Pattern-matches on
 * `kind` and applies the appropriate theme colors.
 *
 * - "diff": unified-style line diff with red removed / green added
 *   prefixed with `-`/`+`, unchanged lines dim with two-space gutter.
 * - "code": fixed-width content shown in normal text color, no escapes.
 *   Useful for things like Write's content or Task agent's prompt where
 *   showing the JSON-escaped \n would be unreadable.
 */
function ToolPreview(props: { preview: RichPreview }) {
  const theme = useTheme()
  const p = props.preview
  if (p.kind === "diff") {
    const lines = lineDiff(p.before, p.after)
    return (
      <box flexDirection="column" flexShrink={0}>
        <Show when={p.label}>
          <text fg={theme.textDim}>{`[${p.label}]`}</text>
        </Show>
        <For each={lines}>
          {(line) => {
            if (line.kind === "removed") return <text fg={theme.error}>{"- " + line.text}</text>
            if (line.kind === "added") return <text fg={theme.success}>{"+ " + line.text}</text>
            return <text fg={theme.textDim}>{"  " + line.text}</text>
          }}
        </For>
      </box>
    )
  }
  if (p.kind === "code") {
    return (
      <box flexDirection="column" flexShrink={0}>
        <Show when={p.label}>
          <text fg={theme.textDim}>{`[${p.label}]`}</text>
        </Show>
        <text fg={theme.text}>{p.content}</text>
      </box>
    )
  }
  return null
}

function truncateLine(s: string, max: number): string {
  // Take only the first line first (multi-line headlines look bad
  // anchored next to the tool name), then ellipsize.
  const firstLine = s.split("\n", 1)[0] ?? ""
  if (firstLine.length <= max) return firstLine
  return firstLine.slice(0, max - 1) + "…"
}

function ToolResultBlock(props: { item: ToolResultDisplayItem }) {
  const theme = useTheme()
  const expand = useExpand()
  const lines = () => props.item.output.split("\n")
  const overflow = () => Math.max(0, lines().length - COLLAPSED_LINE_LIMIT)
  // Same per-tool toggle as ToolCallBlock — keyed on toolUseId so both
  // halves of the same tool invocation expand/collapse together.
  const onClick = () => expand.toggleOne(props.item.toolUseId)
  const isExpanded = () => expand.isExpanded(props.item.toolUseId)
  return (
    <box
      flexShrink={0}
      paddingLeft={3}
      borderColor={theme.toolMuted}
      border={["left"]}
      onMouseUp={onClick}
    >
      <Show
        when={isExpanded()}
        fallback={
          <>
            <text fg={theme.textMuted}>{lines().slice(0, COLLAPSED_LINE_LIMIT).join("\n")}</text>
            <Show when={overflow() > 0}>
              <text fg={theme.textDim}>{`+${overflow()} more — click to expand`}</text>
            </Show>
          </>
        }
      >
        <text fg={props.item.isError ? theme.error : theme.textMuted}>{props.item.output}</text>
      </Show>
    </box>
  )
}

function SystemNotice(props: { item: SystemNoticeDisplayItem }) {
  const theme = useTheme()
  return (
    <box marginTop={1} flexShrink={0}>
      <text fg={theme.textDim}>{"  " + props.item.text}</text>
    </box>
  )
}

function ErrorNotice(props: { item: ErrorDisplayItem }) {
  const theme = useTheme()
  return (
    <box marginTop={1} flexShrink={0} paddingLeft={1} borderColor={theme.error} border={["left"]}>
      <text fg={theme.error}>{"  error"}</text>
      <text fg={theme.text}>{props.item.text}</text>
    </box>
  )
}

function prefix(p: string, body: string): string {
  return body
    .split("\n")
    .map((l) => p + l)
    .join("\n")
}
