import type { TurboConfig } from './config';

/**
 * Escapes regular-expression metacharacters so a configured marker like `[LOG]` is matched literally rather than as a character class.
 */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Matches a turbo log — a call to one of the supported logging functions whose first string literal *begins* with the marker.
 *
 * Every callee is matched, not just the configured one, so logs inserted before a settings change are still found.
 * Both quote styles are matched for the same reason.
 *
 * The `developer.log` prefix is matched as *any* identifier rather than the configured alias.
 * Insertion adopts an alias already present in the file, so pinning this to the setting made the
 * extension unable to find logs it had just written — `dev.log(…)` inserted, then invisible to
 * comment, delete and correct.
 *
 * The marker must be the first thing inside the literal.
 * `print('user said {marker} hello')` is a hand-written log and is deliberately not matched.
 *
 * The statement body excludes `;`, so a line holding a log *and* a second statement does not match
 * at all. The bulk commands edit whole lines, and a greedy body let `print('…'); doSomething();`
 * match as one unit — deleting the log took the other statement with it.
 *
 * Capture groups: 1 leading indentation, 2 the `//` of a commented log if present, 3 the statement itself.
 * The returned expression is stateful (`g`); callers must not share it across passes.
 */
export function turboLogPattern(config: TurboConfig): RegExp {
  const marker = escapeRegExp(config.marker);
  const callee = `(?:print|debugPrint|[A-Za-z_$][A-Za-z0-9_$]*\\.log)`;

  return new RegExp(
    `^([ \\t]*)(//[ \\t]?)?(${callee}\\(\\s*['"]${marker}[^;]*\\);)[ \\t]*(?://.*)?$`,
    'gm',
  );
}

/** Dart's multi-line string delimiters. Their contents are text, not code. */
const TRIPLE_QUOTE = /'''|"""/g;

/**
 * Marks which lines sit inside a multi-line string literal.
 *
 * A `'''` block can hold anything, including something shaped exactly like a log. Editing those
 * lines rewrites the contents of a string — a code template or a test fixture — rather than code,
 * so the bulk and correct commands skip them.
 *
 * Counts delimiters rather than parsing: a `'''` inside a single-quoted string would confuse it,
 * which is rare enough to accept and errs toward skipping rather than editing.
 */
export function linesInsideStrings(lines: readonly string[]): boolean[] {
  let inside = false;

  return lines.map((line) => {
    const startedInside = inside;
    const delimiters = line.match(TRIPLE_QUOTE)?.length ?? 0;
    if (delimiters % 2 === 1) {
      inside = !inside;
    }
    // A line that opens or closes the block is itself part of the surrounding
    // code, so only lines fully within it are skipped.
    return startedInside && inside;
  });
}

export interface TurboLogParts {
  /** Leading whitespace, preserved so commenting does not reindent. */
  indent: string;
  /** The `//` and any following space, present only on a commented log. */
  comment: string;
  /** The statement itself, from the callee through the trailing semicolon. */
  statement: string;
}

/**
 * Splits a single line into its turbo-log parts, or returns `undefined` when the line is not one.
 *
 * Keeping the split here means the bulk commands never construct a pattern of their own, which is what let three of them drift into never matching anything.
 */
export function matchTurboLog(
  line: string,
  config: TurboConfig,
): TurboLogParts | undefined {
  const match = turboLogPattern(config).exec(line);
  if (!match) {
    return undefined;
  }
  return {
    indent: match[1] ?? '',
    comment: match[2] ?? '',
    statement: match[3] ?? '',
  };
}

/**
 * True when the line is a turbo log, commented or not.
 */
export function isTurboLog(line: string, config: TurboConfig): boolean {
  return matchTurboLog(line, config) !== undefined;
}
