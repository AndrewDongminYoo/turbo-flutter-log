import type { Quote, TurboConfig } from './config';
import { developerLogLevel } from './levels';

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

function symbolOf(config: TurboConfig, context: LogContext): string {
  return [
    config.includeEnclosingClass ? context.enclosingClass : undefined,
    config.includeEnclosingFunction ? context.enclosingFunction : undefined,
  ]
    .filter((part): part is string => Boolean(part))
    .join('.');
}

function locationOf(config: TurboConfig, context: LogContext): string {
  if (!config.includeFileName) {
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
): string {
  const quote = config.quote;
  const escape = (text: string): string => escapeLiteral(text, quote);
  const isDeveloperLog = config.logFunction === 'developer.log';
  const symbol = symbolOf(config, context);

  const segments = [
    config.marker,
    isDeveloperLog ? '' : `[${config.logLevel.toUpperCase()}]`,
    escape(locationOf(config, context)),
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
