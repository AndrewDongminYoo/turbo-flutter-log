import { isLogLevel, type LogLevel } from './levels';

/**
 * Dart logging calls the extension can emit.
 * `Logger()` from `package:logger` is deliberately absent; see the v1 spec's non-goals.
 */
export const LOG_FUNCTIONS = ['print', 'debugPrint', 'developer.log'] as const;

export type LogFunction = (typeof LOG_FUNCTIONS)[number];

export const QUOTES = ["'", '"'] as const;

export type Quote = (typeof QUOTES)[number];

export interface TurboConfig {
  logFunction: LogFunction;
  logLevel: LogLevel;
  marker: string;
  delimiter: string;
  quote: Quote;
  includeFileName: boolean;
  includeLineNumber: boolean;
  includeEnclosingClass: boolean;
  includeEnclosingFunction: boolean;
  insertEmptyLineBefore: boolean;
  insertEmptyLineAfter: boolean;
  developerLogAlias: string;
}

export const DEFAULT_CONFIG: TurboConfig = {
  logFunction: 'debugPrint',
  logLevel: 'debug',
  marker: '🎯',
  delimiter: ' · ',
  quote: "'",
  includeFileName: true,
  includeLineNumber: true,
  includeEnclosingClass: true,
  includeEnclosingFunction: true,
  insertEmptyLineBefore: false,
  insertEmptyLineAfter: false,
  developerLogAlias: 'developer',
};

/**
 * Settings as read from VS Code: any key may be missing, and any value may be of the wrong type.
 */
export type RawConfig = Partial<Record<keyof TurboConfig, unknown>>;

/**
 * A marker is embedded verbatim in a Dart string literal and in the detection pattern.
 * Forbidding these characters keeps both sides exact: no escaping on the way out, no unescaping on the way back in.
 */
const FORBIDDEN_IN_MARKER = /['"\\$]/;

const DART_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function pickString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Normalises raw settings into a usable config, falling back to the default for anything invalid.
 *
 * An empty `marker` is preserved rather than clamped to the default.
 * The command layer refuses to run on an empty marker, and clamping here would make that refusal unreachable.
 */
export function resolveConfig(raw: RawConfig): TurboConfig {
  const marker = pickString(raw.marker, DEFAULT_CONFIG.marker);

  return {
    logFunction: (LOG_FUNCTIONS as readonly unknown[]).includes(raw.logFunction)
      ? (raw.logFunction as LogFunction)
      : DEFAULT_CONFIG.logFunction,
    logLevel: isLogLevel(raw.logLevel) ? raw.logLevel : DEFAULT_CONFIG.logLevel,
    marker: FORBIDDEN_IN_MARKER.test(marker) ? DEFAULT_CONFIG.marker : marker,
    delimiter: pickString(raw.delimiter, DEFAULT_CONFIG.delimiter),
    quote: (QUOTES as readonly unknown[]).includes(raw.quote)
      ? (raw.quote as Quote)
      : DEFAULT_CONFIG.quote,
    includeFileName: pickBoolean(
      raw.includeFileName,
      DEFAULT_CONFIG.includeFileName,
    ),
    includeLineNumber: pickBoolean(
      raw.includeLineNumber,
      DEFAULT_CONFIG.includeLineNumber,
    ),
    includeEnclosingClass: pickBoolean(
      raw.includeEnclosingClass,
      DEFAULT_CONFIG.includeEnclosingClass,
    ),
    includeEnclosingFunction: pickBoolean(
      raw.includeEnclosingFunction,
      DEFAULT_CONFIG.includeEnclosingFunction,
    ),
    insertEmptyLineBefore: pickBoolean(
      raw.insertEmptyLineBefore,
      DEFAULT_CONFIG.insertEmptyLineBefore,
    ),
    insertEmptyLineAfter: pickBoolean(
      raw.insertEmptyLineAfter,
      DEFAULT_CONFIG.insertEmptyLineAfter,
    ),
    developerLogAlias: DART_IDENTIFIER.test(
      pickString(raw.developerLogAlias, ''),
    )
      ? (raw.developerLogAlias as string)
      : DEFAULT_CONFIG.developerLogAlias,
  };
}

/**
 * False when the user explicitly cleared the marker.
 * Every command refuses to run in that state: an unmarked log can never be cleaned up, and an empty marker would make the detection pattern match every log in the file.
 */
export function hasUsableMarker(config: TurboConfig): boolean {
  return config.marker.length > 0;
}
