/**
 * Split markdown source into segments the renderer can lay out
 * structurally — text, horizontal rules, and blockquotes.
 *
 * Why split at the source layer
 * -----------------------------
 * opentui's <markdown> renderer bundles non-block tokens into a single
 * text chunk fed to a tree-sitter-markdown CodeRenderable. That works
 * fine for most things, but two constructs benefit from being broken
 * out and rendered with real layout boxes:
 *
 *   1. Horizontal rules (`---`, `***`, `___`)
 *      - The CodeRenderable would just paint the literal `---`
 *        characters. To get a *visible* line we'd have to substitute a
 *        long unicode string at fixed width, which doesn't track the
 *        terminal width on resize.
 *      - Worse: when a bundled chunk happens to start with `---`
 *        (very common — opentui flushes a chunk after every blockquote/
 *        code/table, and a section break `---` often follows), the
 *        markdown grammar matches it as a YAML frontmatter open via
 *
 *          ([(plus_metadata) (minus_metadata)] @keyword.directive
 *            (#set! priority 90))
 *
 *        With priority 90 it overrides every nested scope inside the
 *        "frontmatter" body — extending until the next `---` — and the
 *        cascading scope bleeds styling across whole sections.
 *
 *      Splitting fixes both: each segment is parsed independently (no
 *      chunk starts with `---`), and the renderer puts a 1-row
 *      <box border={["top"]} width="100%"> between segments so the
 *      rule follows the actual container width on every render.
 *
 *   2. Blockquotes (`> ...`)
 *      - The default rendering keeps the literal `>` markers in the
 *        text. A left-edge `│` bar reads better and matches what most
 *        chat / docs UIs do.
 *      - To get that, we extract blockquote sections, strip one layer
 *        of `> ` from each line, and the renderer wraps the stripped
 *        content in <box border={["left"]} borderColor=rule
 *        paddingLeft={1}>.
 *      - Nested `> >` quotes work for free: after stripping one layer
 *        the inner content still starts with `>`, so a recursive
 *        splitMarkdown call extracts the inner blockquote and wraps it
 *        in another bordered box, producing nested vertical bars.
 *
 * Setext heading underlines (`Title\n---`) are preserved — we only
 * split on hr lines that have a blank line above OR are at the start
 * of the input. A `---` immediately after non-blank text stays in
 * place so marked still parses it as a setext h2 underline.
 */

export type MarkdownSegment =
  | { kind: "text"; text: string }
  | { kind: "rule" }
  | { kind: "blockquote"; text: string }

/**
 * Split `text` into the structural segment list described above.
 *
 * - Text segments preserve internal whitespace but are trimmed of
 *   leading/trailing blank lines so the renderer doesn't insert blank
 *   <markdown> elements with no content.
 * - Rule segments carry no payload — the renderer draws a horizontal
 *   line for each.
 * - Blockquote segments hold the inner content with one layer of `> `
 *   stripped. Re-running splitMarkdown on a blockquote's text is what
 *   surfaces nested quotes.
 */
export function splitMarkdown(text: string): MarkdownSegment[] {
  const lines = text.split("\n")
  const segments: MarkdownSegment[] = []
  let buf: string[] = []
  const flushText = () => {
    while (buf.length > 0 && buf[0]!.trim() === "") buf.shift()
    while (buf.length > 0 && buf[buf.length - 1]!.trim() === "") buf.pop()
    if (buf.length > 0) {
      segments.push({ kind: "text", text: buf.join("\n") })
    }
    buf = []
  }
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (isHorizontalRule(line, i, lines)) {
      flushText()
      segments.push({ kind: "rule" })
      i++
      continue
    }
    if (isBlockquoteLine(line)) {
      flushText()
      const bqLines: string[] = []
      while (i < lines.length && isBlockquoteLine(lines[i]!)) {
        bqLines.push(stripBlockquoteMarker(lines[i]!))
        i++
      }
      // Trim leading/trailing blank lines from the inner content so
      // the recursive renderer doesn't open the blockquote box with
      // empty space at the top.
      while (bqLines.length > 0 && bqLines[0]!.trim() === "") bqLines.shift()
      while (bqLines.length > 0 && bqLines[bqLines.length - 1]!.trim() === "") bqLines.pop()
      if (bqLines.length > 0) {
        segments.push({ kind: "blockquote", text: bqLines.join("\n") })
      }
      continue
    }
    buf.push(line)
    i++
  }
  flushText()
  return segments
}

/**
 * Backwards-compatible export for callers that only care about hr
 * splitting. Internally just calls splitMarkdown and filters to text
 * + rule segments — useful for tests that shouldn't have to know
 * about blockquote handling.
 */
export function splitOnHorizontalRules(text: string): MarkdownSegment[] {
  return splitMarkdown(text).filter((s) => s.kind !== "blockquote")
}

/**
 * True if `lines[i]` is a markdown horizontal rule. Same rule the
 * markdown parser uses internally:
 *   - the trimmed line is N≥3 of the same `-`, `*`, or `_` char
 *   - the previous non-empty line is blank, OR i === 0 (start of
 *     input). This keeps setext heading underlines (`Title\n---`)
 *     out of the match.
 */
function isHorizontalRule(line: string, i: number, lines: string[]): boolean {
  const t = line.trim()
  if (t.length < 3) return false
  const ch = t[0]
  if (ch !== "-" && ch !== "*" && ch !== "_") return false
  for (let k = 1; k < t.length; k++) {
    if (t[k] !== ch) return false
  }
  const prev = i > 0 ? lines[i - 1] : undefined
  return prev === undefined || prev.trim() === ""
}

/**
 * True if `line` looks like the start of (or continuation of) a
 * blockquote line — leading whitespace, then `>`. Empty `>` lines
 * count too: marked treats them as blank-line separators inside the
 * blockquote, and we want to keep them grouped with the surrounding
 * blockquote rather than splitting on them.
 */
function isBlockquoteLine(line: string): boolean {
  return /^\s*>/.test(line)
}

/**
 * Strip exactly one layer of `>` (and an optional single trailing
 * space) from the start of a blockquote line. Anything past the marker
 * — including additional `> ` for nested quotes — is preserved
 * verbatim so the recursive splitter can find the nested blockquote.
 */
function stripBlockquoteMarker(line: string): string {
  const m = line.match(/^\s*>(\s?)(.*)$/)
  if (!m) return line
  return m[2] ?? ""
}
