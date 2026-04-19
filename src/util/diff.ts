/**
 * Minimal line-level diff producing a unified-diff-style sequence of
 * removed / added / unchanged lines.
 *
 * Algorithm: classic LCS DP table + backtrack. O(N*M) time and space
 * where N, M are line counts — fine for the Edit tool's typical
 * old_string/new_string sizes (rarely more than ~100 lines on each
 * side). Don't use this on multi-megabyte inputs.
 *
 * No external dependencies — the npm `diff` package would do this and
 * more, but a hand-rolled LCS keeps the build slim and the output
 * shape exactly what our renderer expects.
 */

export type DiffLineKind = "removed" | "added" | "unchanged"

export interface DiffLine {
  kind: DiffLineKind
  /** The line text, NOT including the trailing newline. */
  text: string
  /**
   * Side-specific line numbers, both 1-indexed:
   *   - removed lines: only `oldNo` is set (no equivalent on the new side)
   *   - added lines:   only `newNo` is set
   *   - unchanged:     both set (same logical line, different position)
   *
   * The renderer uses these for the gutter, in the same convention as
   * `git diff` shown in side-by-side mode.
   */
  oldNo?: number
  newNo?: number
}

/**
 * Compute a line-by-line diff. Both inputs are split on `\n` first.
 * Empty inputs are treated as zero-line documents.
 */
export function lineDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText === "" ? [] : oldText.split("\n")
  const b = newText === "" ? [] : newText.split("\n")
  const m = a.length
  const n = b.length

  // dp[i][j] = LCS length of a[0..i) and b[0..j).
  // Build with one row of length n+1 reused per i — but for clarity
  // we'll use the full 2D table (cheap at our sizes).
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = (dp[i - 1]![j - 1] ?? 0) + 1
      } else {
        const up = dp[i - 1]![j] ?? 0
        const left = dp[i]![j - 1] ?? 0
        dp[i]![j] = up >= left ? up : left
      }
    }
  }

  // Backtrack from (m, n) to (0, 0), prepending lines to the result.
  // The line numbers we emit are the original positions on each side
  // (1-indexed) — `i` and `j` are 1-based when we record the line that
  // ends at that position.
  const result: DiffLine[] = []
  let i = m
  let j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift({ kind: "unchanged", text: a[i - 1]!, oldNo: i, newNo: j })
      i--
      j--
    } else if ((dp[i - 1]![j] ?? 0) >= (dp[i]![j - 1] ?? 0)) {
      result.unshift({ kind: "removed", text: a[i - 1]!, oldNo: i })
      i--
    } else {
      result.unshift({ kind: "added", text: b[j - 1]!, newNo: j })
      j--
    }
  }
  while (i > 0) {
    result.unshift({ kind: "removed", text: a[i - 1]!, oldNo: i })
    i--
  }
  while (j > 0) {
    result.unshift({ kind: "added", text: b[j - 1]!, newNo: j })
    j--
  }
  return result
}
