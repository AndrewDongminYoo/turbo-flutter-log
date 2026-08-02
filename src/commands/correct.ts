import * as path from 'path';

import * as vscode from 'vscode';

import {
  enclosingSymbolsIn,
  readPageWidth,
  readSymbolTree,
  readTurboConfig,
  requireDartEditor,
} from '../editor';
import {
  findExpressionLine,
  linesInsideStrings,
  matchTurboLog,
} from '../marker';
import { parseTurboLog } from '../parse';
import { isLoggableExpression } from '../target';
import { buildLogStatementWithin } from '../statement';

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
  const lines = document.getText().split('\n');
  const inString = linesInsideStrings(lines);
  // Nothing is edited until the loop is over, so the symbol tree is the same for
  // every log in the file and is fetched once rather than per correction.
  const symbols = await readSymbolTree(document);

  for (let line = 0; line < document.lineCount; line += 1) {
    if (inString[line]) {
      continue;
    }

    const raw = document.lineAt(line).text;
    const parts = matchTurboLog(raw, config);
    if (!parts) {
      continue;
    }

    const parsed = parseTurboLog(parts.statement, config);
    // Rewriting from a misread expression would break a log that works today —
    // an expression containing the delimiter is one way to misread one. Leaving
    // it alone is always safe; correcting it is not.
    if (!parsed || !isLoggableExpression(parsed.expression)) {
      continue;
    }

    const expressionLine = findExpressionLine(
      lines,
      line,
      parsed.expression,
      config,
    );
    const { enclosingClass, enclosingFunction } = enclosingSymbolsIn(
      symbols,
      expressionLine,
    );

    const statement = buildLogStatementWithin(
      {
        ...config,
        logFunction: parsed.logFunction,
        logLevel: parsed.logLevel ?? config.logLevel,
        quote: parsed.quote,
        // The alias the log was written with, not the configured preference: a
        // file that imports `dart:developer` only as `dev` stops compiling if a
        // correction re-emits the call as `developer.log`.
        developerLogAlias: parsed.developerLogAlias ?? config.developerLogAlias,
      },
      {
        fileName,
        lineNumber: expressionLine + 1,
        enclosingClass,
        enclosingFunction,
        expression: parsed.expression,
      },
      // The budget is what the statement is allowed to fill, and a commented log
      // starts after its own `// `; measuring against the indent alone let the
      // rewritten line overflow by exactly that much.
      parts.indent + parts.comment,
      pageWidth,
    );

    const text = `${parts.indent}${parts.comment}${statement}${parts.trailing}`;
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
