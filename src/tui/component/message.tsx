/**
 * Renders one DisplayItem in the scrollback. Splits per-kind so each block
 * style stays isolated. Tool-call/result blocks honor the global expand
 * state (Ctrl+O) and collapse to a one-line summary when shrunk.
 */

import { For, Show, createMemo } from "solid-js"
import { useTheme, useThemeContext } from "../context/theme.tsx"
import { useExpand } from "../context/expand.tsx"
import { useSettings } from "../context/settings.tsx"
import { modeLabel } from "../../agent/modes.ts"
import {
  displayToolName,
  formatToolInput,
  jsonExcluding,
  type RichPreview,
} from "../../util/tool-format.ts"
import { lineDiff } from "../../util/diff.ts"
import { splitMarkdown, type MarkdownSegment } from "../../util/markdown-segments.ts"
import type {
  AssistantDisplayMessage,
  DisplayItem,
  ErrorDisplayItem,
  SystemNoticeDisplayItem,
  ToolCallDisplayItem,
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
  const settings = useSettings()
  // The assistant is the *primary* voice in the conversation; everything
  // else (user input, tool calls, system notices) is a side-channel that
  // gets a colored left border to attribute it. Assistant text renders
  // flush against the left edge so it reads as the main flow rather
  // than a quoted aside.
  //
  // Rendering strategy depends on two settings:
  //   - markdown: false → always plain text (tables stay as raw pipes)
  //   - markdown: true && markdownStreaming: true → live markdown,
  //       reparses on every chunk; opentui's `streaming` flag keeps the
  //       trailing block unstable so a half-built list/table doesn't lock
  //       in early.
  //   - markdown: true && markdownStreaming: false → plain text WHILE
  //       streaming, then swaps to formatted markdown once complete.
  //       Avoids the per-chunk reparse cost / flicker on slow terminals.
  //
  // The decision is reactive: toggling /markdown or /markdown-stream
  // mid-conversation immediately rerenders existing bubbles in their
  // new style.
  const useMarkdown = () => settings.markdown() && (props.msg.complete || settings.markdownStreaming())
  // Split the markdown source into structural segments (text, rule,
  // blockquote). Each blockquote's inner content is recursively
  // re-split by <MarkdownContent>, so nested `> >` quotes naturally
  // produce nested left-bar boxes. See src/util/markdown-segments.ts
  // for why we split at the source layer.
  const segments = createMemo(() => splitMarkdown(props.msg.text))
  // Built once per theme, but we need to thread it through the JSX so
  // SolidJS only rebuilds the markdown renderable when content/style
  // actually changes.
  const tableOpts = createMemo(() => ({
    borders: true,
    outerBorder: true,
    borderStyle: "rounded" as const,
    borderColor: theme.markdown.tableBorder,
    cellPadding: 1,
    wrapMode: "word" as const,
  }))
  return (
    <box marginTop={1} flexShrink={0}>
      <Show when={props.msg.thinking}>
        <text fg={theme.thinking}>{prefix("thinking: ", props.msg.thinking ?? "")}</text>
      </Show>
      <Show when={props.msg.text}>
        <Show
          when={useMarkdown()}
          fallback={<text fg={theme.text}>{props.msg.text}</text>}
        >
          <MarkdownContent
            segments={segments()}
            streaming={!props.msg.complete}
            tableOpts={tableOpts()}
          />
        </Show>
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
  )
}

/**
 * Recursive renderer for the MarkdownSegment list:
 *
 *   - text       → <markdown> element with our syntaxStyle + tree-sitter
 *   - rule       → 1-row <box border={["top"]}> that follows the
 *                  container width (resizes with the terminal)
 *   - blockquote → <box border={["left"]}> wrapping a recursive
 *                  <MarkdownContent> on the stripped inner text. The
 *                  recursion is what makes nested `> >` quotes show
 *                  as nested left-bar boxes — each strip layer wraps
 *                  the inner content in another bordered box.
 *
 * `streaming` and `tableOpts` are forwarded to every nested <markdown>.
 * Streaming is technically only relevant to the trailing block, but
 * keeping it on for completed inner segments is harmless — opentui
 * just leaves the trailing parse stable, which is what we want anyway.
 */
function MarkdownContent(props: {
  segments: MarkdownSegment[]
  streaming: boolean
  tableOpts: Record<string, unknown>
}) {
  const theme = useTheme()
  const { syntaxStyle, treeSitterClient } = useThemeContext()
  return (
    <For each={props.segments}>
      {(seg) => {
        if (seg.kind === "rule") {
          // 1-row box, no content, just a top border. Width defaults to
          // 100% of the parent so the rule automatically follows the
          // terminal width on resize — same mechanism opentui uses for
          // table borders. marginTop/marginBottom give the rule a
          // paragraph worth of breathing room above and below.
          return (
            <box
              height={1}
              marginTop={1}
              marginBottom={1}
              flexShrink={0}
              border={["top"]}
              borderStyle="single"
              borderColor={theme.markdown.rule}
            />
          )
        }
        if (seg.kind === "blockquote") {
          // Left-edge `│` indicator in the Claude warm-orange (the
          // same `theme.primary` we use for the prompt indicator and
          // list bullets — visually consistent with "this marker
          // means structurally distinguished content"), against a
          // barely-there bg fill (backgroundPanel — only one step
          // darker than the main bg) so the quoted region reads as a
          // distinct surface without competing visually with code
          // blocks or dialogs.
          //
          // Recursing on splitMarkdown(seg.text) lets nested `> >`
          // quotes naturally produce nested bordered boxes because
          // the stripped inner content still starts with `>`.
          const innerSegments = createMemo(() => splitMarkdown(seg.text))
          return (
            <box
              marginTop={1}
              flexShrink={0}
              border={["left"]}
              borderStyle="single"
              borderColor={theme.primary}
              backgroundColor={theme.backgroundPanel}
              paddingLeft={1}
              paddingRight={1}
            >
              <MarkdownContent
                segments={innerSegments()}
                streaming={props.streaming}
                tableOpts={props.tableOpts}
              />
            </box>
          )
        }
        // text
        return (
          <markdown
            content={seg.text}
            syntaxStyle={syntaxStyle}
            treeSitterClient={treeSitterClient}
            fg={theme.text}
            conceal={true}
            concealCode={false}
            streaming={props.streaming}
            tableOptions={props.tableOpts}
          />
        )
      }}
    </For>
  )
}

// Max characters of headline shown next to the tool name. Long inputs
// (e.g. very long Bash commands) get truncated here and shown in full
// when the user clicks to expand.
const HEADLINE_MAX = 80

/**
 * Render order inside the tool block (top to bottom):
 *
 *   1. Tool header line — `Edit · auth/context_test.go`
 *   2. Tool result      — first 3 lines collapsed, full when expanded.
 *                          Stays here regardless of expansion state, so
 *                          "The file ... has been updated successfully."
 *                          remains anchored just below the header.
 *   3. Expanded extras  — JSON body + rich previews (diff, code, etc.).
 *                          Only when expanded.
 *
 * Click anywhere in the block to toggle expansion for this specific
 * tool (per-tool override on top of the global Ctrl+O state).
 */
function ToolCallBlock(props: { item: ToolCallDisplayItem }) {
  const theme = useTheme()
  const expand = useExpand()
  const onClick = () => expand.toggleOne(props.item.toolUseId)
  const isExpanded = () => expand.isExpanded(props.item.toolUseId)
  const formatted = createMemo(() => formatToolInput(props.item.toolName, props.item.input))
  const niceName = () => displayToolName(props.item.toolName)
  const header = () => {
    const head = formatted().headline
    const headlinePart = head ? "  ·  " + truncateLine(head, HEADLINE_MAX) : ""
    return "  " + niceName() + headlinePart + (props.item.resolved ? "" : " ...")
  }
  const previews = () => formatted().previews ?? []
  const consumedAttrs = createMemo(() => new Set(previews().flatMap((p) => p.attrs)))
  const jsonBody = () => jsonExcluding(props.item.input, consumedAttrs())

  // Result-text rendering — collapsed = first N lines + overflow hint;
  // expanded = full output.
  const result = () => props.item.result
  const resultLines = () => (result()?.output ?? "").split("\n")
  const resultOverflow = () => Math.max(0, resultLines().length - COLLAPSED_LINE_LIMIT)

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

      {/* Result block (always rendered, between header and extras) */}
      <Show when={result()}>
        {(r) => (
          <box flexShrink={0} paddingLeft={2}>
            <Show
              when={isExpanded()}
              fallback={
                <>
                  <text fg={r().isError ? theme.error : theme.textMuted}>
                    {resultLines().slice(0, COLLAPSED_LINE_LIMIT).join("\n")}
                  </text>
                  <Show when={resultOverflow() > 0}>
                    <text fg={theme.textDim}>{`+${resultOverflow()} more — click to expand`}</text>
                  </Show>
                </>
              }
            >
              <text fg={r().isError ? theme.error : theme.textMuted}>{r().output}</text>
            </Show>
          </box>
        )}
      </Show>

      {/* Expanded extras: JSON of inputs (minus consumed) + previews */}
      <Show when={isExpanded()}>
        <box flexDirection="column" gap={1} paddingTop={1}>
          <text fg={theme.toolMuted}>{jsonBody()}</text>
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
    // Auto-size each line-number column to the widest entry. Floor at
    // 3 chars (most edits stay short; "  1" reads better than "1").
    let maxOld = 0
    let maxNew = 0
    for (const line of lines) {
      if (line.oldNo !== undefined && line.oldNo > maxOld) maxOld = line.oldNo
      if (line.newNo !== undefined && line.newNo > maxNew) maxNew = line.newNo
    }
    const oldW = Math.max(3, String(maxOld).length)
    const newW = Math.max(3, String(maxNew).length)
    const fmtNum = (n: number | undefined, w: number) =>
      n === undefined ? " ".repeat(w) : String(n).padStart(w, " ")
    return (
      <box flexDirection="column" flexShrink={0}>
        <Show when={p.label}>
          <text fg={theme.textDim}>{`[${p.label}]`}</text>
        </Show>
        <For each={lines}>
          {(line) => {
            const sigil = line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "
            const gutter = `${fmtNum(line.oldNo, oldW)} ${fmtNum(line.newNo, newW)} ${sigil} `
            const fg =
              line.kind === "removed"
                ? theme.error
                : line.kind === "added"
                  ? theme.success
                  : theme.textDim
            return <text fg={fg}>{gutter + line.text}</text>
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


function SystemNotice(props: { item: SystemNoticeDisplayItem }) {
  const theme = useTheme()
  // Default to "debug" so any pre-existing callsite that doesn't
  // pass a tone still gets the dim look it had before this prop
  // existed. New callers should opt into "info" for user-facing
  // notices that should be easy to read.
  const fg = () => (props.item.tone === "info" ? theme.textMuted : theme.textDim)
  return (
    <box marginTop={1} flexShrink={0}>
      <text fg={fg()}>{"  " + props.item.text}</text>
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
