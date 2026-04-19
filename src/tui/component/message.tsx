/**
 * Renders one DisplayItem in the scrollback. Splits per-kind so each block
 * style stays isolated. Tool-call/result blocks honor the global expand
 * state (Ctrl+O) and collapse to a one-line summary when shrunk.
 */

import { Show } from "solid-js"
import { useTheme } from "../context/theme.tsx"
import { useExpand } from "../context/expand.tsx"
import { modeLabel } from "../../agent/modes.ts"
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

function ToolCallBlock(props: { item: ToolCallDisplayItem }) {
  const theme = useTheme()
  const expand = useExpand()
  // Click handler flips this specific tool's per-tool override. Both
  // the call and the result share the same `toolUseId` so they stay
  // visually in sync — clicking either side flips both.
  const onClick = () => expand.toggleOne(props.item.toolUseId)
  const isExpanded = () => expand.isExpanded(props.item.toolUseId)
  return (
    <box
      marginTop={1}
      flexShrink={0}
      paddingLeft={1}
      borderColor={theme.tool}
      border={["left"]}
      onMouseUp={onClick}
    >
      <text fg={theme.tool}>
        {"  "}
        {props.item.toolName}
        {props.item.resolved ? "" : " ..."}
      </text>
      <Show when={isExpanded()} fallback={<text fg={theme.toolMuted}>{summarize(props.item.inputJson)}</text>}>
        <text fg={theme.toolMuted}>{props.item.inputJson}</text>
      </Show>
    </box>
  )
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

function summarize(s: string): string {
  const firstLine = s.split("\n", 1)[0] ?? ""
  return firstLine.length > 80 ? firstLine.slice(0, 77) + "..." : firstLine
}

function prefix(p: string, body: string): string {
  return body
    .split("\n")
    .map((l) => p + l)
    .join("\n")
}
