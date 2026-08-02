/**
 * `dart format` wraps at a page width that can only be set in `analysis_options.yaml`:
 *
 * ```yaml
 * formatter:
 *   page_width: 100
 * ```
 *
 * This matters more than aesthetics. A log that overflows gets split across three lines by the
 * formatter, and the detection pattern — which needs the callee and the marker on one line — stops
 * matching it, so the bulk commands can no longer find it to comment or delete.
 */

/** `dart format`'s own default when nothing declares one. */
export const DEFAULT_PAGE_WIDTH = 80;

/**
 * Reads `formatter.page_width` from the text of an `analysis_options.yaml`.
 *
 * Deliberately a line scanner rather than a YAML parser: this is the only key ever read, and a
 * dependency to fetch one integer is not worth it.
 *
 * `include:` directives are not followed, so a width inherited from an included package is missed
 * and the caller falls back to the default — which errs toward shorter logs, the safe direction.
 */
export function parsePageWidth(yaml: string): number | undefined {
  let inFormatter = false;

  for (const line of yaml.split('\n')) {
    if (/^\S/.test(line)) {
      inFormatter = /^formatter\s*:/.test(line);
      continue;
    }
    if (!inFormatter) {
      continue;
    }

    const match = /^\s+page_width\s*:\s*(\d+)/.exec(line);
    if (match) {
      const width = Number(match[1]);
      return width > 0 ? width : undefined;
    }
  }

  return undefined;
}

/**
 * True when a statement fits on one line once indented.
 *
 * `dart format` counts UTF-16 code units, the same unit JavaScript's `String.length` reports —
 * verified by bisecting the wrap point with and without a leading emoji, which split at exactly the
 * same length. So no display-width calculation is needed.
 */
export function fitsOnOneLine(
  statement: string,
  indent: string,
  pageWidth: number,
): boolean {
  return indent.length + statement.length <= pageWidth;
}
