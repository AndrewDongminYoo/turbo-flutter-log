import * as path from 'path';

import * as vscode from 'vscode';

import {
  readPageWidth,
  readTurboConfig,
  requireDartEditor,
  resolveEnclosingSymbols,
} from '../editor';
import { matchTurboLog } from '../marker';
import { parseTurboLog } from '../parse';
import { buildLogStatementWithin } from '../statement';

/**
 * Finds the line the logged expression lives on, searching upwards from the log.
 *
 * A log sits after the statement it reports, so the expression is above it — but not necessarily on
 * the line directly above, since that may be the closing line of a multi-line statement. Matching
 * the expression text is exact where it works, and the line above is a reasonable answer where it
 * does not.
 */
function findExpressionLine(
  document: vscode.TextDocument,
  logLine: number,
  expression: string,
): number {
  for (let line = logLine - 1; line >= 0 && line >= logLine - 20; line -= 1) {
    if (document.lineAt(line).text.includes(expression)) {
      return line;
    }
  }
  return Math.max(0, logLine - 1);
}

/**
 * Re-emits every turbo log in the active file with a fresh file name, line number, and enclosing
 * symbol, so logs stay accurate after the code around them moves.
 *
 * The function, severity, and logged expression are read back from each statement and preserved: a
 * correction fixes positions, it does not restyle. Segments the page width forces out are dropped
 * again on the way back, so a corrected log still fits on one line.
 */
export async function correctAllLogMessages(): Promise<void> {
  const config = readTurboConfig(vscode.window.activeTextEditor?.document);
  const editor = requireDartEditor(config);
  if (!editor) {
    return;
  }

  const document = editor.document;
  const fileName = path.basename(document.fileName);
  const pageWidth = await readPageWidth(document);

  const corrections: { line: number; text: string }[] = [];

  for (let line = 0; line < document.lineCount; line += 1) {
    const raw = document.lineAt(line).text;
    const parts = matchTurboLog(raw, config);
    if (!parts) {
      continue;
    }

    const parsed = parseTurboLog(parts.statement, config);
    if (!parsed) {
      continue;
    }

    const expressionLine = findExpressionLine(
      document,
      line,
      parsed.expression,
    );
    const { enclosingClass, enclosingFunction } = await resolveEnclosingSymbols(
      document,
      expressionLine,
    );

    const statement = buildLogStatementWithin(
      {
        ...config,
        logFunction: parsed.logFunction,
        logLevel: parsed.logLevel ?? config.logLevel,
        quote: parsed.quote,
      },
      {
        fileName,
        lineNumber: expressionLine + 1,
        enclosingClass,
        enclosingFunction,
        expression: parsed.expression,
      },
      parts.indent,
      pageWidth,
    );

    const text = `${parts.indent}${parts.comment}${statement}`;
    if (text !== raw) {
      corrections.push({ line, text });
    }
  }

  if (corrections.length === 0) {
    void vscode.window.showInformationMessage(
      'turbo-flutter-log: every log message is already accurate.',
    );
    return;
  }

  await editor.edit((builder) => {
    for (const correction of corrections) {
      builder.replace(document.lineAt(correction.line).range, correction.text);
    }
  });

  void vscode.window.showInformationMessage(
    `turbo-flutter-log: corrected ${corrections.length} log message${corrections.length === 1 ? '' : 's'}.`,
  );
}
