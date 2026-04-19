/**
 * Renders the modal-dialog stack on top of the chat. Mounted at the
 * BOTTOM of the provider tree (alongside <Chat />, inside every
 * provider) so dialog factories can use any context — useDialog,
 * useCommand, useAgent, useTheme, etc. — without crashing.
 *
 * Visual layout:
 *
 *   ┌─────────────────────────────────────────────────────┐
 *   │ Commands › Switch session                  [close]  │  ← breadcrumb header
 *   │ ─────────────────────────────────────────────────── │
 *   │ <factory()>                                          │  ← current dialog body
 *   └─────────────────────────────────────────────────────┘
 *
 * Each segment of the breadcrumb is clickable — clicking pops down to
 * that level. [close] clears everything. Esc / Ctrl+C pop one level
 * (handler registered ONLY while the overlay is mounted).
 *
 * Lifetime split:
 *   - DialogOverlay always mounts; it's the conditional gate.
 *   - DialogOverlayBody mounts ONLY when the stack is non-empty.
 *     The Esc/Ctrl+C key handler lives in the body so opentui's
 *     useKeyboard auto-(un)subscribes via Solid's lifecycle. While no
 *     dialog is open, the global key handler isn't even registered.
 */

import { For, Show } from "solid-js"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import { useDialog } from "../context/dialog.tsx"
import { useTheme } from "../context/theme.tsx"
import { dlog } from "../../util/debug-log.ts"

export function DialogOverlay() {
  const dialog = useDialog()
  return (
    <Show when={dialog.size() > 0}>
      <DialogOverlayBody />
    </Show>
  )
}

function DialogOverlayBody() {
  const dialog = useDialog()
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const theme = useTheme()

  // Esc / Ctrl+C close the top dialog. opentui registers this on mount
  // and tears it down on cleanup — so when the dialog closes (Show
  // flips false), the binding is automatically removed.
  useKeyboard((evt) => {
    const isEsc = evt.name === "escape"
    const isCtrlC = evt.ctrl === true && evt.name === "c"
    if (!isEsc && !isCtrlC) return
    if (renderer.getSelection()) return
    dlog("dialog.key.close", { key: isEsc ? "esc" : "ctrl+c" })
    dialog.pop()
    evt.preventDefault()
    evt.stopPropagation()
  })

  // Sentinel to ignore clicks inside the dialog body that bubble up to
  // the backdrop. Backdrop click pops one level (consistent with Esc).
  let dismiss = false

  return (
    <box
      position="absolute"
      width={dimensions().width}
      height={dimensions().height}
      left={0}
      top={0}
      alignItems="center"
      paddingTop={Math.max(2, Math.floor(dimensions().height / 6))}
      backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
      onMouseDown={() => {
        dismiss = !renderer.getSelection()
      }}
      onMouseUp={() => {
        if (!dismiss) return
        dismiss = false
        dialog.pop()
      }}
    >
      <box
        width={Math.min(80, dimensions().width - 4)}
        flexDirection="column"
        backgroundColor={theme.backgroundPanel}
        borderColor={theme.border}
        border={["top", "bottom", "left", "right"]}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={1}
        paddingRight={1}
        gap={1}
        onMouseDown={(e) => {
          dismiss = false
          e.stopPropagation()
        }}
        onMouseUp={(e) => {
          dismiss = false
          e.stopPropagation()
        }}
      >
        <Breadcrumbs />
        {dialog._stack().at(-1)!.factory()}
      </box>
    </box>
  )
}

function Breadcrumbs() {
  const theme = useTheme()
  const dialog = useDialog()
  return (
    <box flexDirection="row" flexShrink={0}>
      <For each={dialog._stack()}>
        {(entry, index) => {
          const isLast = () => index() === dialog._stack().length - 1
          const label = () => entry.title ?? "Dialog"
          return (
            <>
              <Show when={index() > 0}>
                <text fg={theme.textDim}>{" › "}</text>
              </Show>
              <text
                fg={isLast() ? theme.text : theme.textMuted}
                onMouseUp={(e) => {
                  if (isLast()) return
                  e.stopPropagation()
                  dialog.popTo(index())
                }}
              >
                {label()}
              </text>
            </>
          )
        }}
      </For>
      <box flexGrow={1} />
      <text
        fg={theme.warn}
        onMouseUp={(e) => {
          e.stopPropagation()
          dialog.clear()
        }}
      >
        {"[close]"}
      </text>
    </box>
  )
}
