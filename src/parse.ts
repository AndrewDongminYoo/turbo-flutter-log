import {
  LOG_FUNCTIONS,
  QUOTES,
  type LogFunction,
  type Quote,
  type TurboConfig,
} from './config';
import { isLogLevel, levelFromDeveloperLog, type LogLevel } from './levels';

/**
 * What a turbo log carries, recovered from its own text.
 *
 * The correct command re-emits a statement with a fresh file, line, and enclosing symbol, so it has
 * to read back the parts that must survive: which function was used, at which severity, and above
 * all what was being logged.
 */
export interface ParsedLog {
  logFunction: LogFunction;
  logLevel?: LogLevel;
  quote: Quote;
  /**
   * The prefix an aliased `developer.log` was written with, absent for the other two functions.
   *
   * Re-emitting from the configured alias instead would rewrite `dev.log(…)` into
   * `developer.log(…)` in a file that only imports `dev`, and the file would stop compiling.
   */
  developerLogAlias?: string;
  /** The Dart expression the log reports, taken from the payload segment. */
  expression: string;
}

/** Undoes the escaping `statement.ts` applies to literal segments. */
function unescapeLiteral(text: string, quote: Quote): string {
  return text
    .replace(/\\\$/g, '$')
    .split(`\\${quote}`)
    .join(quote)
    .replace(/\\\\/g, '\\');
}

/**
 * Reads a turbo log back into its parts, or returns `undefined` when the text is not one.
 *
 * The payload is always the last segment and always `<expression>: <interpolation>`, which is what
 * makes this recoverable at all — every other segment is optional and may have been dropped to fit
 * the page width.
 */
export function parseTurboLog(
  statement: string,
  config: TurboConfig,
): ParsedLog | undefined {
  // The `developer.log` prefix is matched as *any* identifier, for the reason the
  // detection pattern does: insertion adopts an alias already present in the file,
  // so pinning this to the configured one made every `dev.log(…)` unparseable and
  // the correct command skipped it silently.
  //
  // The message runs to the first *unescaped* closing quote, with `${…}` consumed
  // whole so an interpolated `m['k']` does not end it early. A greedy match would
  // swallow `developer.log`'s trailing `name: '…'` argument along with it.
  const match = new RegExp(
    `^(print|debugPrint|[A-Za-z_$][A-Za-z0-9_$]*\\.log)\\(\\s*(['"])((?:\\\\.|\\$\\{[^}]*\\}|(?!\\2).)*)\\2(.*)\\);$`,
  ).exec(statement.trim());

  if (!match) {
    return undefined;
  }

  const callee = match[1];
  const quote = match[2] as Quote;
  const message = match[3];
  const rest = match[4];

  const logFunction = (LOG_FUNCTIONS as readonly string[]).includes(callee)
    ? (callee as LogFunction)
    : 'developer.log';

  if (!(QUOTES as readonly string[]).includes(quote)) {
    return undefined;
  }

  // The payload is the last segment; the expression is its label, which is the
  // escaped source text of what was logged.
  const segments = message.split(config.delimiter);
  const payload = segments[segments.length - 1] ?? '';
  const separator = payload.lastIndexOf(': ');
  if (separator === -1) {
    return undefined;
  }

  const expression = unescapeLiteral(payload.slice(0, separator), quote);
  if (expression.length === 0) {
    return undefined;
  }

  return {
    logFunction,
    logLevel: levelOf(segments, rest),
    quote,
    developerLogAlias:
      logFunction === 'developer.log' ? callee.slice(0, -4) : undefined,
    expression,
  };
}

/**
 * Recovers the severity from whichever form the log used, or `undefined` when the width ladder
 * dropped the tag and there is no `level:` argument to read.
 */
function levelOf(segments: string[], rest: string): LogLevel | undefined {
  const tagged = segments
    .map((segment) => /^\[([A-Z]+)\]$/.exec(segment.trim())?.[1])
    .find((tag): tag is string => tag !== undefined);

  if (tagged !== undefined) {
    const level = tagged.toLowerCase();
    if (isLogLevel(level)) {
      return level;
    }
  }

  const numeric = /\blevel:\s*(\d+)/.exec(rest);
  return numeric ? levelFromDeveloperLog(Number(numeric[1])) : undefined;
}
