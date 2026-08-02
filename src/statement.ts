import type { Quote, TurboConfig } from './config';
import { developerLogLevel } from './levels';
import { fitsOnOneLine } from './width';

/**
 * Everything the builder needs about where the log is going.
 * Resolved by the command layer; this module stays free of `vscode`.
 */
export interface LogContext {
  /** File name only, not a path — for example `main.dart`. */
  fileName: string;
  /** One-based, matching what the editor shows. */
  lineNumber: number;
  enclosingClass?: string;
  enclosingFunction?: string;
  /** The Dart expression being logged, exactly as it appears in the source. */
  expression: string;
}

/** Dart interpolates a bare `$name` only for a plain identifier; everything else needs `${...}`. */
const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Escapes text that sits in a Dart string literal outside an interpolation block.
 *
 * Order matters: backslashes first, or the escapes added afterwards would themselves be escaped.
 * An unescaped `$` would open an interpolation; an unescaped quote would close the literal.
 */
export function escapeLiteral(text: string, quote: Quote): string {
  return text
    .replace(/\\/g, '\\\\')
    .split(quote)
    .join(`\\${quote}`)
    .replace(/\$/g, '\\$');
}

/**
 * Wraps an expression for interpolation.
 * Needs no escaping: Dart allows the enclosing quote character inside `${...}`.
 */
export function interpolate(expression: string): string {
  return PLAIN_IDENTIFIER.test(expression)
    ? `$${expression}`
    : `\${${expression}}`;
}

/**
 * Optional parts, in the order they are given up when the line would otherwise overflow.
 *
 * The location goes first: the file is already on screen, and the line number drifts with every
 * later edit. The level tag goes next, since it is usually the same for every log in a session.
 * The enclosing symbol is the most useful context in console output, so it survives longest, and
 * the payload is never dropped — it is the whole point of the statement.
 */
export type Omission = 'location' | 'level' | 'class' | 'function';

const OMISSION_LADDER: readonly Omission[][] = [
  [],
  ['location'],
  ['location', 'level'],
  ['location', 'level', 'class'],
  ['location', 'level', 'class', 'function'],
];

function symbolOf(
  config: TurboConfig,
  context: LogContext,
  omitted: ReadonlySet<Omission>,
): string {
  return [
    config.includeEnclosingClass && !omitted.has('class')
      ? context.enclosingClass
      : undefined,
    config.includeEnclosingFunction && !omitted.has('function')
      ? context.enclosingFunction
      : undefined,
  ]
    .filter((part): part is string => Boolean(part))
    .join('.');
}

function locationOf(
  config: TurboConfig,
  context: LogContext,
  omitted: ReadonlySet<Omission>,
): string {
  if (!config.includeFileName || omitted.has('location')) {
    return '';
  }
  return config.includeLineNumber
    ? `${context.fileName}:${context.lineNumber}`
    : context.fileName;
}

/**
 * Builds the full Dart statement, without indentation or trailing newline.
 *
 * `developer.log` carries the symbol in `name:` and the severity in `level:`, because its API models them as fields.
 * The other two functions fold everything into the message.
 */
export function buildLogStatement(
  config: TurboConfig,
  context: LogContext,
  omitted: ReadonlySet<Omission> = new Set(),
): string {
  const quote = config.quote;
  const escape = (text: string): string => escapeLiteral(text, quote);
  const isDeveloperLog = config.logFunction === 'developer.log';
  const symbol = symbolOf(config, context, omitted);

  const segments = [
    config.marker,
    isDeveloperLog || omitted.has('level')
      ? ''
      : `[${config.logLevel.toUpperCase()}]`,
    escape(locationOf(config, context, omitted)),
    isDeveloperLog ? '' : escape(symbol),
    `${escape(context.expression)}: ${interpolate(context.expression)}`,
  ].filter((segment) => segment.length > 0);

  const message = `${quote}${segments.join(escape(config.delimiter))}${quote}`;

  if (!isDeveloperLog) {
    return `${config.logFunction}(${message});`;
  }

  const args = [message];
  if (symbol) {
    args.push(`name: ${quote}${escape(symbol)}${quote}`);
  }
  args.push(`level: ${developerLogLevel(config.logLevel)}`);

  return `${config.developerLogAlias}.log(${args.join(', ')});`;
}

/**
 * Builds the statement, giving up optional segments until it fits on one line.
 *
 * Overflow is not cosmetic: `dart format` would split the statement across three lines, and the
 * detection pattern needs the callee and the marker together, so a split log can no longer be
 * commented or deleted by the bulk commands.
 *
 * When even the barest form overflows — a long expression is enough on its own — that form is
 * returned anyway. Nothing further can be dropped without discarding the value being logged.
 */
export function buildLogStatementWithin(
  config: TurboConfig,
  context: LogContext,
  indent: string,
  pageWidth: number,
): string {
  let statement = '';

  for (const omitted of OMISSION_LADDER) {
    statement = buildLogStatement(config, context, new Set(omitted));
    if (fitsOnOneLine(statement, indent, pageWidth)) {
      return statement;
    }
  }

  return statement;
}

/**
 * Wraps a statement into the text inserted at the start of the following line, carrying the surrounding indentation and any requested blank lines.
 */
export function renderStatementBlock(
  statement: string,
  indent: string,
  config: TurboConfig,
): string {
  const before = config.insertEmptyLineBefore ? '\n' : '';
  const after = config.insertEmptyLineAfter ? '\n' : '';

  return `${before}${indent}${statement}\n${after}`;
}

/** The leading whitespace of a line, so an inserted log lines up with the code it follows. */
export function indentationOf(line: string): string {
  return /^[ \t]*/.exec(line)?.[0] ?? '';
}
