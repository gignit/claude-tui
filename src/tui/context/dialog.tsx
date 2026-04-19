/**
 * Modal dialog stack. One dialog visible at a time, but pushable so a
 * dialog can spawn a sub-dialog and return to its parent on close.
 *
 * IMPORTANT: this file exposes only a CONTEXT (no overlay JSX). The
 * actual overlay is rendered by `<DialogOverlay />` which lives in
 * `component/dialog-overlay.tsx`. We keep them separate so the overlay
 * can be mounted at the bottom of the provider tree where every other
 * context (Agent, Command, Theme, …) is available; if we rendered the
 * overlay inside DialogProvider itself, dialog factories that call
 * `useCommand()`, `useAgent()`, etc. would crash because those
 * providers are children of DialogProvider, not ancestors.
 *
 */

import { createContext, useContext, type JSX, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { dlog } from "../../util/debug-log.ts"

export interface DialogOpenOptions {
  /** Title shown in the breadcrumb at the top of the overlay. */
  title?: string
  /** Fired when this entry is removed from the stack (pop, clear, replace). */
  onClose?: () => void
}

export interface DialogEntry extends DialogOpenOptions {
  /**
   * Stored as a thunk (not a pre-built JSX element). Solid evaluates
   * `{thunk}` in JSX by calling it inside the surrounding component
   * scope, which keeps reactivity (createSignal/createEffect/createResource)
   * wired to the right owner. Pre-building the JSX in dialog.replace and
   * stashing the result here breaks reactivity.
   */
  factory: () => JSX.Element
}

export interface DialogContext {
  /** Replace the entire stack with a single new dialog. Most common op. */
  replace: (factory: () => JSX.Element, opts?: DialogOpenOptions) => void
  /** Push a sub-dialog onto the stack. The previous top is hidden but kept. */
  push: (factory: () => JSX.Element, opts?: DialogOpenOptions) => void
  /** Pop the topmost dialog (firing its onClose). */
  pop: () => void
  /** Pop the stack down to (and including index `keep`). */
  popTo: (keep: number) => void
  /** Close every dialog. */
  clear: () => void
  /** Reactive: number of dialogs currently stacked. */
  size: () => number
  /**
   * Internal: read the current stack. Used by <DialogOverlay /> only —
   * application code should treat the stack as opaque.
   */
  _stack: () => DialogEntry[]
  /**
   * Register a callback to fire whenever the stack transitions back to
   * empty (the overlay just closed). Used by the prompt to reclaim
   * focus so the user can keep typing.
   */
  onClosed: (cb: () => void) => () => void
}

const Ctx = createContext<DialogContext | null>(null)

export function DialogProvider(props: ParentProps) {
  const [store, setStore] = createStore<{ stack: DialogEntry[] }>({ stack: [] })

  const fireClose = (entry: DialogEntry) => {
    try {
      entry.onClose?.()
    } catch (err) {
      dlog("dialog.onclose.error", { error: String(err) })
    }
  }

  const closedListeners = new Set<() => void>()
  const fireClosedIfEmpty = () => {
    if (store.stack.length !== 0) return
    for (const cb of closedListeners) {
      try {
        cb()
      } catch (err) {
        dlog("dialog.onclosed.error", { error: String(err) })
      }
    }
  }

  const value: DialogContext = {
    replace: (factory, opts) => {
      dlog("dialog.replace", { title: opts?.title })
      for (const e of store.stack) fireClose(e)
      setStore("stack", [{ factory, ...opts }])
    },
    push: (factory, opts) => {
      dlog("dialog.push", { title: opts?.title })
      setStore("stack", [...store.stack, { factory, ...opts }])
    },
    pop: () => {
      const top = store.stack.at(-1)
      if (!top) return
      dlog("dialog.pop", { title: top.title })
      fireClose(top)
      setStore("stack", store.stack.slice(0, -1))
      fireClosedIfEmpty()
    },
    popTo: (keep) => {
      if (keep < -1) return
      const next = store.stack.slice(0, keep + 1)
      const removed = store.stack.slice(keep + 1)
      if (removed.length === 0) return
      dlog("dialog.popTo", { keep, removed: removed.length })
      for (const e of removed) fireClose(e)
      setStore("stack", next)
      fireClosedIfEmpty()
    },
    clear: () => {
      if (store.stack.length === 0) return
      dlog("dialog.clear", { closing: store.stack.length })
      for (const e of store.stack) fireClose(e)
      setStore("stack", [])
      fireClosedIfEmpty()
    },
    size: () => store.stack.length,
    _stack: () => store.stack,
    onClosed: (cb) => {
      closedListeners.add(cb)
      return () => closedListeners.delete(cb)
    },
  }

  // NOTE: the Esc / Ctrl+C close handler is registered by DialogOverlay
  // (which mounts/unmounts with the stack) rather than here. That way
  // the binding only exists when a dialog is actually showing — opentui
  // handles the (un)registration via Solid's onMount/onCleanup, exactly
  // the pattern the user pointed out.

  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>
}

export function useDialog(): DialogContext {
  const c = useContext(Ctx)
  if (!c) throw new Error("useDialog() called outside <DialogProvider>")
  return c
}
