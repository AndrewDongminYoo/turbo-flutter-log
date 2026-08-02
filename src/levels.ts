/**
 * Severity levels offered by the `turbo-flutter-log.logLevel` setting, ordered from least to most severe.
 */
export const LOG_LEVELS = [
  'trace',
  'debug',
  'info',
  'warning',
  'error',
  'fatal',
] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * `dart:developer`'s `log()` documents `level` as "a value between 0 and 2000; see the `package:logging` `Level` class for an overview of the possible values".
 * These are those constants: FINEST, FINE, INFO, WARNING, SEVERE, SHOUT.
 */
const DEVELOPER_LOG_LEVELS: Record<LogLevel, number> = {
  trace: 300,
  debug: 500,
  info: 800,
  warning: 900,
  error: 1000,
  fatal: 1200,
};

/**
 * Returns the integer to pass as `developer.log(..., level:)` for a configured level.
 */
export function developerLogLevel(level: LogLevel): number {
  return DEVELOPER_LOG_LEVELS[level];
}

/**
 * Returns true when `value` is one of the levels the extension accepts.
 * Used to fall back to the default rather than trusting an arbitrary settings string.
 */
export function isLogLevel(value: unknown): value is LogLevel {
  return (
    typeof value === 'string' &&
    (LOG_LEVELS as readonly string[]).includes(value)
  );
}
