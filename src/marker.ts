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
 * The marker must be the first thing inside the literal.
 * `print('user said {marker} hello')` is a hand-written log and is deliberately not matched.
 *
 * Capture groups: 1 leading indentation, 2 the `//` of a commented log if present, 3 the statement itself.
 * The returned expression is stateful (`g`); callers must not share it across passes.
 */
export function turboLogPattern(config: TurboConfig): RegExp {
  const marker = escapeRegExp(config.marker);
  const alias = escapeRegExp(config.developerLogAlias);
  const callee = `(?:print|debugPrint|${alias}\\.log)`;

  return new RegExp(
    `^([ \\t]*)(//[ \\t]?)?(${callee}\\(\\s*['"]${marker}.*\\);)[ \\t]*$`,
    'gm',
  );
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
