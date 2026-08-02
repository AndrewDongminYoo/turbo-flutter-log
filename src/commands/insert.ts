import * as path from 'path';

import * as vscode from 'vscode';

import {
  enclosingSymbolsIn,
  readPageWidth,
  readSymbolTree,
  readTurboConfig,
  requireDartEditor,
  resolveTarget,
} from '../editor';
import { importShift, planImport } from '../imports';
import {
  buildLogStatementWithin,
  indentationOf,
  renderStatementBlock,
} from '../statement';

/** Dart's standard indent, used when a log goes at the top of a block. */
const DART_INDENT = '  ';

/**
 * Inserts a log statement for every cursor.
 *
 * All insertions, and the `dart:developer` directive when one is needed, are applied in a single `editor.edit()` so the whole command is one undo step.
 */
export async function displayLogMessage(): Promise<void> {
  const config = readTurboConfig(vscode.window.activeTextEditor?.document);
  const editor = requireDartEditor(config);
  if (!editor) {
    return;
  }

  const document = editor.document;
  const fileName = path.basename(document.fileName);

  // The plan comes first: it may adopt an alias already used in this file, and
  // the emitted call has to match that rather than the configured preference.
  const importPlan = planImport(
    document.getText().split('\n'),
    config.logFunction,
    config.developerLogAlias,
  );
  const effective = { ...config, developerLogAlias: importPlan.alias };

  const pageWidth = await readPageWidth(document);
  // One tree for the whole command: nothing is edited until the end, so every
  // cursor resolves against the same symbols.
  const symbols = await readSymbolTree(document);

  const insertions = await Promise.all(
    editor.selections.map(async (selection) => {
      const target = await resolveTarget(document, selection);
      if (!target) {
        return undefined;
      }

      const { enclosingClass, enclosingFunction } = enclosingSymbolsIn(
        symbols,
        selection.active.line,
      );

      const indent =
        indentationOf(document.lineAt(target.indentFromLine).text) +
        (target.insideBlock ? DART_INDENT : '');
      const shift = importShift(importPlan, target.expressionLine);
      const statement = buildLogStatementWithin(
        effective,
        {
          fileName,
          // The line of the logged expression, one-based as the editor shows it —
          // not the line the log itself lands on, and after any directive this
          // command is about to insert above it.
          lineNumber: target.expressionLine + 1 + shift,
          enclosingClass,
          enclosingFunction,
          expression: target.expression,
        },
        indent,
        pageWidth,
      );

      return {
        line: target.insertAfterLine,
        text: renderStatementBlock(statement, indent, effective),
      };
    }),
  );

  const resolved = insertions.filter(
    (insertion): insertion is NonNullable<typeof insertion> =>
      insertion !== undefined,
  );

  if (resolved.length === 0) {
    void vscode.window.showWarningMessage(
      'turbo-flutter-log: nothing to log at the cursor. Select an expression, or place the cursor inside one.',
    );
    return;
  }

  await editor.edit((builder) => {
    for (const insertion of resolved) {
      builder.insert(
        new vscode.Position(insertion.line + 1, 0),
        insertion.text,
      );
    }
    if (importPlan?.insertAtLine !== undefined) {
      builder.insert(
        new vscode.Position(importPlan.insertAtLine, 0),
        `${importPlan.text}\n`,
      );
    }
  });
}
