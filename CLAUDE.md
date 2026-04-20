# claude-tui — Project Playbook

> Hand-written project guidance. Update freely.

## What this project is

A small terminal UI for the **Claude Agent SDK**. Runs on Bun. Stack:

| Layer | Library | Purpose |
| ----- | ------- | ------- |
| Renderer | `@opentui/core` + `@opentui/solid` | terminal rendering, mouse, keyboard |
| Reactivity | `solid-js` | signals, stores, JSX |
| Agent | `@anthropic-ai/claude-agent-sdk` | spawns the user's `claude` binary, streams turns |

The whole app is ~1.5k lines of TypeScript. We talk to the Claude runtime
through the public Agent SDK only — we don't fork, modify, or
deobfuscate the bundled product.

## Where to look first when adding a feature

1. **Browse `src/`.** Layout map is in the README under "Layout".
2. **Verify opentui APIs from the installed source** in
   `node_modules/@opentui/core/` and `node_modules/@opentui/solid/`.
   opentui is pre-1.0 and the docs are sparse — the type definitions
   and source files are the truth.
3. **Verify Agent SDK APIs from `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`.**
   The `Query` interface around line 1870 documents every control
   method (`setModel`, `setPermissionMode`, `interrupt`, `accountInfo`,
   `supportedModels`, `setMcpServers`, `close`, etc.).

## opentui pitfalls we have already hit

These are non-obvious. Save the rediscovery time.

| Symptom | Root cause | Fix |
| ------- | ---------- | --- |
| Enter inserts a newline instead of submitting | Default textarea binds `return → newline` (see `@opentui/core/src/renderables/Textarea.ts`'s `defaultTextareaKeybindings`) | Pass `keyBindings={[{name:"return",action:"submit"}]}` to `<textarea>` |
| Children stack horizontally inside `<box>` | Yoga's default `flexDirection` differs from CSS expectations; opentui benchmark code always sets it explicitly | Always set `flexDirection="column"` (or `"row"`) on layout boxes — don't rely on the default |
| Scrollbox content rendering BEHIND the prompt | I tried `contentOptions: { minHeight: "100%", justifyContent: "flex-end" }` to bottom-pin. It made content render outside the viewport. | Don't bottom-pin. Use a scrollbox with `flexGrow={1}` plus a sibling `<box flexShrink={0}>` footer. Use `gap={1}` for breathing room. |
| `onContentChange` callback receives no string | opentui's textarea emits `ContentChangeEvent` (no payload by design — see `EditBufferRenderable.ts`) | Read text from the ref: `textarea.plainText` |
| JSX intrinsics not typed (`<box>` doesn't exist on `JSX.IntrinsicElements`) | Wrong jsxImportSource | `tsconfig.json: jsxImportSource: "@opentui/solid"` AND `bunfig.toml: preload = ["@opentui/solid/preload"]` |
| Bundled SDK can't find a `claude` binary on glibc Linux | The SDK ships `@anthropic-ai/claude-agent-sdk-linux-x64-musl` as an optional native dep; not installed on glibc systems | Auto-detect a `claude` on PATH or `~/.local/bin/claude` and pass `pathToClaudeCodeExecutable` to `query()`. See `findClaudeExecutable()` in `src/agent/client.ts`. |
| Solid disposes unrelated owners (e.g. dialog opens → agent provider closes) | Bun resolved `solid-js` to its SSR build (`dist/server.js`) by default | Force the browser/reactive build via `--conditions=browser` (set in `package.json` scripts and `bin/claude-tui`) and `customConditions: ["browser"]` in `tsconfig.json` |
| Dialog body crashes with `useX() called outside <XProvider>` | The DialogProvider's overlay JSX renders inside DialogProvider's scope, OUTSIDE later providers (CommandProvider, AgentProvider) | Render the overlay (`DialogOverlay`) at the bottom of the provider tree alongside `<Chat />`, not inside DialogProvider. DialogProvider exposes context only. |

## How to add a new feature: standard workflow

1. **Decide where state lives.**
   - Per-render? local `createSignal`.
   - Cross-component, ephemeral? new context provider in `src/tui/context/`.
   - Persists across runs? add a field to `PersistedState` in
     `src/util/state-store.ts`.
2. **If it talks to the SDK**, extend `AgentClient` (in
   `src/agent/client.ts`) — keep the SDK message shapes confined to that
   file. The TUI must only see DisplayItems / AgentEvents.
3. **If it's user-invocable**, register it in `src/tui/routes/commands.tsx`
   so it shows up in Ctrl+K and `/` autocomplete:
   ```tsx
   {
     value: "thing.do",
     title: "Do thing",
     description: "...",
     category: "App",
     slash: { name: "do-thing" },
     opensDialog: true,         // if onSelect pushes a sub-dialog
     onSelect: () => dialog.push(() => <YourDialog />, { title: "Do thing" }),
   }
   ```
4. **If it adds a global hotkey**, add an Action to `keybind.tsx`'s
   `BINDINGS` and handle it in `chat.tsx`'s `useKeyboard`.
5. **Wire it through the provider tree in `src/tui/app.tsx`** if it needs
   a new context.
6. **Run `bun run typecheck`** — must be exit 0 before testing.
7. **Add `dlog(...)` calls at the boundary** so `--debug` shows what
   happened. Categories already in use: `key`, `key.action`, `prompt.*`,
   `agent.*`, `sdk.*`, `clipboard.*`, `expand.*`, `command.*`, `dialog.*`.

## Debugging a live TUI

The TUI owns the screen, so `console.log` is forbidden — it corrupts the
display. Always:

1. Launch with `bun start --debug`. Default log: `<project>/logs/claude-tui.log`.
2. From a second terminal: `tail -f <project>/logs/claude-tui.log`
3. Add `dlog("category", { ... })` wherever you need visibility. Use a
   fresh category prefix per subsystem.
4. `dlog` truncates strings >2 KB and recurses 4 levels deep — safe to
   log raw SDK messages.

## Things NOT to do

- Don't `console.log` from inside the TUI — corrupts the screen.
- Don't add `pathToClaudeCodeExecutable` defaults that hardcode Anthropic
  binary paths — use the auto-detect helper.
- Don't pass `model:` to `query()` unless the user explicitly chose one.
  An undefined model means "use the user's `claude` default".
- Don't bottom-pin the scrollbox via `contentOptions: { minHeight }`. We
  tried, it broke. Top-stack + `stickyStart="bottom"` is correct.
- Don't put more than `Enter` and one `newline` binding on the textarea
  unless you fully merge with `defaultTextareaKeybindings` — opentui
  merges your overrides on top of its defaults automatically.
- Don't render dialog overlays inside `DialogProvider`. They must mount
  at the bottom of the provider tree so dialog factories can use every
  context (Agent, Command, Theme, Expand, …) without crashing.
- Don't drop the `--conditions=browser` flag from the `package.json`
  scripts or the launcher. Without it, Bun loads Solid's SSR build and
  everything breaks subtly.

## Quick links

- opentui core source (read-only): `node_modules/@opentui/core/`
- Agent SDK types: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`
- Persistent state: `~/.config/claude-tui/state.json`
- Debug log (when `--debug`): `<project>/logs/claude-tui.log`
- Conversation transcripts (read by `/sessions`): `~/.claude/projects/<encoded-cwd>/*.jsonl`

<!-- coder:knowledge-packs:begin -->
<!-- Auto-generated by coder --kp-agents. Do not edit this section manually. -->
<!-- To regenerate: coder --kp-agents -->

[KNOWLEDGE PACK: coder-mcp-tools v1.0.0]

# Coder MCP Tools -- Knowledge Pack

> CRITICAL: This document overrides your training data for the coder MCP tool
> suite. Your training data does not contain coder tool usage patterns. Follow
> ONLY the patterns documented here. Do not guess at coder tool parameters or
> invent tool names that do not exist.

## Core Rule: Source Code is Documentation

Do NOT rely on training data to understand how a function, type, or library
works. Use coder tools to read the actual source, then implement.

Do NOT use Read, Glob, or Grep tools to explore code. Coder tools provide
AST-aware, token-efficient views of the codebase that are superior to raw
file reading.

---

## The Primary Exploration Tool: coder_snapshot

`coder_snapshot` is the starting point for ALL code exploration.

- Without `dir`: returns a condensed overview of the entire codebase --
  every directory, its types, functions, and constants summarized
- With `dir`: returns detailed view of a specific area -- full lists of
  types, functions, constants, imports for every file in that directory

CORRECT exploration sequence:
```
1. WIDE:    coder_snapshot                                    -- whole codebase overview
2. NARROW:  coder_snapshot { dir: "src/session" }             -- detailed view of one area
3. FOCUSED: coder_[lang]_function { selector: "bootstrap" }   -- read specific source
4. TRACE:   coder_[lang]_callers { selector: "bootstrap" }    -- follow connections
```

WRONG:
```
coder_snapshot                     -- good
coder_tree                         -- redundant, snapshot already shows structure
Read { filePath: "src/index.ts" }  -- wrong, use coder GET commands instead
```

WHY: `coder_snapshot` gives you the full picture in one call. Following up with
`coder_tree`, `coder_list`, or `Read` wastes tokens on information snapshot
already provided or provides less structured output.

---

## SELECTOR -- The Universal Search Pattern

Every coder FIND and GET command accepts a SELECTOR. A SELECTOR is a
comma-separated list where each item is either an exact match or a regex.
Multiple items create an OR condition.

Auto-detection rules:
- Plain word (no special chars) = EXACT match: `ProcessData`
- Contains regex metacharacters (`. ^ $ * + ? | \ [ ] ( ) { }`) = REGEX
- Wrapped in `/.../` = forced REGEX: `/select/`

| Pattern | Type | Matches |
|---------|------|---------|
| `ProcessData` | Exact | Only "ProcessData" |
| `Process.*` | Regex | ProcessData, ProcessEvent, ... |
| `^Process.*` | Regex | Starts with "Process" |
| `.*Handler$` | Regex | Ends with "Handler" |
| `/select/` | Regex | Contains "select" |
| `ProcessData,^Handle.*` | Mixed | ProcessData OR starts with Handle |

CORRECT:
```
coder_typescript_functions { selector: "^handle" }
```

WRONG:
```
coder_typescript_functions { selector: "handle*" }
```

WHY: Coder uses regex, not glob. `handle*` means "handl" followed by zero or
more "e" characters. Use `^handle` or `handle.*` for prefix matching.

---

## GET Commands Search Globally

GET commands (`function`, `const`, `type`, `class`, `var`) find symbols by
name across the entire codebase. Do NOT pass `dir` to GET commands -- they
do not need it.

CORRECT:
```
coder_[lang]_function { selector: "bootstrap" }
coder_[lang]_const { selector: "COMPACTION_BUFFER" }
```

WRONG:
```
coder_[lang]_function { selector: "bootstrap", dir: "src/cli" }
```

WHY: GET commands search globally. Adding `dir` unnecessarily restricts
results and may miss the symbol if it exists in a different location than
you expect.

---

## FIND Commands Benefit from dir Scoping

FIND commands (`functions`, `types`, `consts`, `classes`) list all symbols.
On large codebases, use `dir` to scope results to the relevant area.

```
coder_[lang]_functions { dir: "src/session" }
coder_[lang]_consts { dir: "src/config" }
```

---

## Tool Naming Convention

`coder_[lang]_[command]`

Where `[lang]` is one of: `typescript`, `go`, `python`, `cpp`

Match the tool to the language of the file you are working with:
- `.ts`, `.tsx`, `.js`, `.jsx` -> `coder_typescript_*`
- `.go` -> `coder_go_*`
- `.py` -> `coder_python_*`
- `.c`, `.cpp`, `.h`, `.hpp` -> `coder_cpp_*`

Language-agnostic command: `coder_snapshot`

---

## Scoping and Output Parameters

| Parameter | Effect |
|-----------|--------|
| dir | Scope to directories (comma-separated) |
| file | Scope to a specific file |
| tests | Include test files alongside production code |
| tests_only | Show ONLY test files |
| external | Show ONLY external dependencies |
| format | compact (default), trunc, json, json-pretty, inline |
| detail | full (default), summary, delta |
| grep | Search within GET results or --file content |
| A | Lines of context after grep match |
| B | Lines of context before grep match |

---

## Module Source as Documentation

For external libraries, pass `module` to any coder tool to read the actual
dependency source -- not docs, not type stubs, the real implementation.

| Parameter | Description |
|-----------|-------------|
| module: "pkg" | Use version from project manifest |
| module: "pkg-version" | Use explicit version |
| module: "pkg1,pkg2" | Query multiple modules |

CORRECT:
```
coder_[lang]_function { module: "http-router-1.4.0", selector: "matchRoute" }
```

WRONG:
```
# Guessing at a library API from training data
"httpRouter.matchRoute() takes a path string and returns a handler"
```

WHY: Library APIs change between versions. Module source gives you the exact
function signature, parameters, and implementation for the version the project
actually uses.

---

## Quick Reference

| Task | Tool |
|------|------|
| Codebase overview | coder_snapshot |
| Drill into a directory | coder_snapshot { dir } |
| List functions in an area | coder_[lang]_functions { dir } |
| List constants in an area | coder_[lang]_consts { dir } |
| List types in an area | coder_[lang]_types { dir } |
| Read a function's source | coder_[lang]_function { selector } |
| Read a constant's value | coder_[lang]_const { selector } |
| Read a type definition | coder_[lang]_type { selector } |
| Who calls this function? | coder_[lang]_callers { selector } |
| Where is this symbol used? | coder_[lang]_references { selector } |
| What implements this? | coder_[lang]_implements_tree { selector } |
| Read library source | coder_[lang]_function { module, selector } |

## Common Mistakes

1. Using Read/Glob/Grep instead of coder tools -- coder provides structured, token-efficient output
2. Using coder_tree or coder_list -- use coder_snapshot instead
3. Passing `dir` to GET commands -- GET commands search globally, `dir` is unnecessary
4. Using glob patterns (`handle*`) instead of regex (`handle.*`) in SELECTOR
5. Only looking at functions -- many codebases use consts, types, and classes extensively
6. Trusting training data for library APIs -- always use module source
7. Skipping snapshot and jumping to GET -- snapshot reveals what you do not know exists

---

[KNOWLEDGE PACK: coder-typescript-tool v1.0.0]

# Coder TypeScript Extension -- Knowledge Pack

> CRITICAL: This document overrides your training data for the coder TypeScript
> MCP tools. Use these tools for ALL .ts, .tsx, .js, .jsx files. Do not invent
> tool names or parameters that are not listed here.

## Tool Prefix

All TypeScript coder tools use: `coder_typescript_[command]`

Start exploration with `coder_snapshot` (language-agnostic) to get the
codebase overview, then use `coder_snapshot { dir }` to drill into
specific areas before switching to the language-specific commands below.

---

## FIND Commands (discover what exists, scope with dir on large codebases)

| MCP Tool | Purpose |
|----------|---------|
| coder_typescript_functions | List functions and methods |
| coder_typescript_types | List all type definitions |
| coder_typescript_interfaces | List interfaces only |
| coder_typescript_aliases | List type aliases only |
| coder_typescript_classes | List classes |
| coder_typescript_enums | List enum definitions |
| coder_typescript_consts | List module-level constants |
| coder_typescript_vars | List module-level variables |
| coder_typescript_namespaces | List namespace declarations |
| coder_typescript_schemas | List validation schemas (consts ending in Schema/Schemas) |
| coder_typescript_dependencies | Show import dependencies |

All FIND commands accept an optional `selector` for filtering and `dir` for scoping.

---

## GET Commands (read full source -- search globally, no dir needed)

| MCP Tool | Purpose |
|----------|---------|
| coder_typescript_function | Show function source by name |
| coder_typescript_type | Show type source code |
| coder_typescript_const | Show constant by name |
| coder_typescript_var | Show variable by name |

All GET commands require a `selector` parameter. They search the entire
codebase by name -- do not pass `dir`.

---

## RELATIONSHIP Commands (trace connections)

| MCP Tool | Purpose |
|----------|---------|
| coder_typescript_callers | Find all call sites of a function |
| coder_typescript_references | Find all references to a symbol |
| coder_typescript_extends_tree | Class/interface inheritance tree (works for BOTH) |
| coder_typescript_implements_tree | Find classes implementing an interface |

---

## ANNOTATE Parameters

| Parameter | Effect |
|-----------|--------|
| comments | Include inline and block comments |
| decorators | Include decorator metadata |
| jsdoc | Include JSDoc/docblocks |
| plus | Enable ALL annotations |

CORRECT:
```
coder_typescript_function { selector: "handleRequest", jsdoc: true }
```

WRONG:
```
coder_typescript_function { selector: "handleRequest", docstrings: true }
```

WHY: TypeScript uses `jsdoc`, not `docstrings`. The `docstrings` parameter
is Python-only and does not exist on TypeScript tools.

---

## FILTER Parameters (TypeScript-specific)

| Parameter | Effect |
|-----------|--------|
| decorator | Filter by decorator name (implies --decorators) |

---

## Power Commands

| Pattern | Purpose |
|---------|---------|
| extends_tree { selector: "TypeName" } | Full inheritance tree (classes AND interfaces) |
| implements_tree { selector: "InterfaceName" } | All classes implementing an interface |
| functions { decorator: "Controller" } | Filter by decorator (Angular/NestJS patterns) |

---

## Deep Discovery Workflows

### Processing Pipeline Trace
```
functions { selector: "process.*|handle.*|transform.*" }    -- find entry points
callers { selector: "processNode" }                         -- who initiates
function { selector: "processNode", jsdoc: true }           -- read entry
function { selector: "processNodeWorker", jsdoc: true }     -- find dispatch switch
-- build regex from discovered case handlers, get complete pipeline
function { selector: "handleCase1|handleCase2|handleCase3", jsdoc: true }
```

### Visitor/Transformer Architecture
```
functions { selector: "visit.*|transform.*" }               -- map visitor functions
callers { selector: "visitNode" }                            -- find orchestrator
function { selector: "visitEachChild", jsdoc: true }         -- understand traversal
implements_tree { selector: "Visitor" }                      -- find all visitor impls
-- build regex from discovered names, get all at once
```

### Decorator/DI Graph (Angular, NestJS)
```
functions { decorator: "Controller" }                        -- find controllers
functions { decorator: "Injectable" }                        -- find services
callers { selector: "ServiceName" }                          -- trace injection points
references { selector: "ServiceInterface" }                  -- find all consumers
-- map complete dependency injection architecture
```

### Type System Flow
```
functions { selector: "check.*|resolve.*|get.*Type", dir: "src/checker" }
callers { selector: "checkExpression" }                      -- find entry
-- trace through checkExpressionWorker -> getTypeOfExpression
-- discover the complete type inference chain
```

### Module Resolution Chain
```
functions { selector: "resolve.*Module.*|getResolved.*" }    -- find resolvers
callers { selector: "resolveModuleName" }                    -- find entry
-- trace through resolution strategies
function { selector: "nodeModuleNameResolver", jsdoc: true } -- understand resolution
```

---

## Codebase Health Audit

- **Any pollution**: `functions` then grep for `any` params/returns -- legitimate: JSON parsing, external interop; red flags: business logic with any
- **Discriminated unions**: `aliases { selector: ".*Result.*|.*State.*" }` then read types -- look for `{ success: true; data: T } | { success: false; error: E }` patterns
- **Import structure**: `dependencies { dir: "src" }` -- find barrel files (index.ts with many re-exports), trace for circular dependency risks
- **Null safety**: `functions { selector: ".*null.*|.*undefined.*|.*optional.*" }` -- check for proper narrowing vs unsafe assertions
- **Class vs union**: `classes` -> `extends_tree` -> if deep hierarchy, check if discriminated unions would be simpler

---

## Quick Reference

| Task | Tool |
|------|------|
| List functions | coder_typescript_functions |
| Read function source | coder_typescript_function |
| List types | coder_typescript_types |
| Read type source | coder_typescript_type |
| List interfaces | coder_typescript_interfaces |
| List classes | coder_typescript_classes |
| List enums | coder_typescript_enums |
| List validation schemas | coder_typescript_schemas |
| List namespaces | coder_typescript_namespaces |
| Find callers | coder_typescript_callers |
| Find references | coder_typescript_references |
| Inheritance tree | coder_typescript_extends_tree |
| Implementations | coder_typescript_implements_tree |
| Import deps | coder_typescript_dependencies |

## Common Mistakes

1. Using `docstrings` instead of `jsdoc` -- TypeScript has jsdoc, not docstrings
2. Using `inheritance_tree` instead of `extends_tree` -- TypeScript uses extends_tree
3. Using `usage` instead of `references` -- TypeScript uses references
4. Forgetting `decorator` filter for Angular/NestJS DI patterns
5. Not using `interfaces` or `aliases` to narrow type searches (using `types` returns all)

<!-- coder:knowledge-packs:end -->
