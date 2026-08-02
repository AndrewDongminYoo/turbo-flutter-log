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

/**
 * True when the line is a turbo log, commented or not.
 * Convenience for single-line checks; bulk commands use {@link turboLogPattern} directly.
 */
export function isTurboLog(line: string, config: TurboConfig): boolean {
  return turboLogPattern(config).test(line);
}
