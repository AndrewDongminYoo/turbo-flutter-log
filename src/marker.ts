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
 * The message literal is scanned rather than skipped over, so a `;` *inside* it is part of the log
 * while a `;` after it ends the statement. The bulk commands edit whole lines, and a body that
 * merely stopped at the first `;` cut both ways: a greedy one let `print('…'); doSomething();` match
 * as one unit and deleting the log took the other statement with it, while a `[^;]*` one refused to
 * match a log whose own message contained a semicolon.
 *
 * `${…}` is consumed whole, because an interpolated expression may carry the enclosing quote —
 * `${m['k']}` inside a single-quoted message is valid Dart and must not end the literal.
 * ponytail: `[^}]*` means an interpolation containing `}` still ends the scan early; a string-mode
 * scanner would be the upgrade if one ever appears.
 *
 * A trailing `\r` is tolerated but never captured: every caller splits the document on `\n`, so on a
 * CRLF file each line arrives with one, and the edits are applied to ranges that exclude the line
 * break anyway. Without this the bulk commands found nothing at all in such a file.
 *
 * Capture groups: 1 leading indentation, 2 the `//` of a commented log if present, 3 the statement
 * itself, 4 the quote that opened the message, 5 anything after the statement — trailing whitespace
 * and a trailing comment, which the commands re-append so rewriting a log does not delete it.
 * The returned expression is stateful (`g`); callers must not share it across passes.
 */
export function turboLogPattern(config: TurboConfig): RegExp {
  const marker = escapeRegExp(config.marker);
  const callee = `(?:print|debugPrint|[A-Za-z_$][A-Za-z0-9_$]*\\.log)`;
  // The two lookaheads keep the alternation unambiguous: the last branch refuses
  // any character another branch already owns — `${` (the interpolation branch)
  // and `\` (the escape branch). Without them a failing match backtracks
  // exponentially, since either branch could consume the same character.
  const literalBody = `(?:\\\\.|\\$\\{[^}]*\\}|(?!\\4)(?!\\$\\{)(?!\\\\).)*`;

  return new RegExp(
    `^([ \\t]*)(//[ \\t]?)?(${callee}\\(\\s*(['"])${marker}${literalBody}\\4[^;]*\\);)([ \\t]*(?://.*)?)\\r?$`,
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
 * Only the delimiter that opened a block can close it. Treating the two as interchangeable let a
 * lone `"""` inside a `'''` block invert the state, after which every real line below the block was
 * skipped as string content.
 *
 * Still not a parser: a `'''` inside a single-quoted string would confuse it, which is rare enough
 * to accept and errs toward skipping rather than editing.
 */
export function linesInsideStrings(lines: readonly string[]): boolean[] {
  let open: string | undefined;

  return lines.map((line) => {
    const startedInside = open !== undefined;
    for (const delimiter of line.match(TRIPLE_QUOTE) ?? []) {
      if (open === undefined) {
        open = delimiter;
      } else if (open === delimiter) {
        open = undefined;
      }
    }
    // A line that opens or closes the block is itself part of the surrounding
    // code, so only lines fully within it are skipped.
    return startedInside && open !== undefined;
  });
}

export interface TurboLogParts {
  /** Leading whitespace, preserved so commenting does not reindent. */
  indent: string;
  /** The `//` and any following space, present only on a commented log. */
  comment: string;
  /** The statement itself, from the callee through the trailing semicolon. */
  statement: string;
  /** Whatever followed the statement — trailing whitespace and a `//` comment. Re-append it when rewriting the line. */
  trailing: string;
}

/**
 * The single-line form of {@link turboLogPattern}, rebuilt only when the marker changes.
 *
 * Both callers run it over every line of the document, and the marker is the pattern's only input,
 * so recompiling per line was thousands of identical `new RegExp` calls per command. Kept separate
 * from the exported one because this instance has no `g` flag: a shared stateful expression would
 * carry `lastIndex` from one line to the next.
 */
let singleLine: { marker: string; pattern: RegExp } | undefined;

/**
 * Splits a single line into its turbo-log parts, or returns `undefined` when the line is not one.
 *
 * Keeping the split here means the bulk commands never construct a pattern of their own, which is what let three of them drift into never matching anything.
 */
export function matchTurboLog(
  line: string,
  config: TurboConfig,
): TurboLogParts | undefined {
  if (singleLine?.marker !== config.marker) {
    singleLine = {
      marker: config.marker,
      pattern: new RegExp(turboLogPattern(config).source),
    };
  }

  const match = singleLine.pattern.exec(line);
  if (!match) {
    return undefined;
  }
  return {
    indent: match[1] ?? '',
    comment: match[2] ?? '',
    statement: match[3] ?? '',
    trailing: match[5] ?? '',
  };
}

/**
 * True when the line is a turbo log, commented or not.
 */
export function isTurboLog(line: string, config: TurboConfig): boolean {
  return matchTurboLog(line, config) !== undefined;
}

/** How far above a log its expression may be, in lines. */
const SEARCH_DEPTH = 20;

/**
 * Finds the line the logged expression lives on, searching upwards from the log.
 *
 * A log sits after the statement it reports, so the expression is above it — but not necessarily on
 * the line directly above, since that may be the closing line of a multi-line statement. Matching
 * the expression text is exact where it works, and the line above is a reasonable answer where it
 * does not.
 *
 * Two kinds of line are skipped rather than matched. Another turbo log for the same variable is the
 * common one — two logs stacked for one variable made the second report the first one's line — and a
 * comment mentioning the variable is the other. The match itself is bounded by identifier
 * characters, so `user` no longer finds `username`.
 *
 * A confidently wrong line number is worse than the stale one it replaced, since accurate line
 * numbers are the only thing the correct command exists to deliver.
 */
export function findExpressionLine(
  lines: readonly string[],
  logLine: number,
  expression: string,
  config: TurboConfig,
): number {
  const occurrence = new RegExp(
    `(?<![A-Za-z0-9_$])${escapeRegExp(expression)}(?![A-Za-z0-9_$])`,
  );

  for (
    let line = logLine - 1;
    line >= 0 && line >= logLine - SEARCH_DEPTH;
    line -= 1
  ) {
    const text = lines[line] ?? '';
    if (text.trimStart().startsWith('//') || isTurboLog(text, config)) {
      continue;
    }
    if (occurrence.test(text)) {
      return line;
    }
  }

  return Math.max(0, logLine - 1);
}
