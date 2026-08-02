import * as path from 'path';

import * as vscode from 'vscode';

import {
  readTurboConfig,
  requireDartEditor,
  resolveEnclosingSymbols,
  resolveTarget,
} from '../editor';
import { planDeveloperImport } from '../imports';
import {
  buildLogStatement,
  indentationOf,
  renderStatementBlock,
} from '../statement';

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
  const importPlan =
    config.logFunction === 'developer.log'
      ? planDeveloperImport(
          document.getText().split('\n'),
          config.developerLogAlias,
        )
      : undefined;
  const effective = importPlan
    ? { ...config, developerLogAlias: importPlan.alias }
    : config;

  const insertions = await Promise.all(
    editor.selections.map(async (selection) => {
      const target = await resolveTarget(document, selection);
      if (!target) {
        return undefined;
      }

      const { enclosingClass, enclosingFunction } =
        await resolveEnclosingSymbols(document, selection.active.line);

      const statement = buildLogStatement(effective, {
        fileName,
        // The editor shows one-based lines, and so should the log.
        lineNumber: target.insertAfterLine + 2,
        enclosingClass,
        enclosingFunction,
        expression: target.expression,
      });

      return {
        line: target.insertAfterLine,
        text: renderStatementBlock(
          statement,
          indentationOf(document.lineAt(target.insertAfterLine).text),
          effective,
        ),
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
