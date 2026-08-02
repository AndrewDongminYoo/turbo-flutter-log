import * as vscode from 'vscode';

import { planBulkEdits, type BulkMode } from '../bulk';
import { readTurboConfig, requireDartEditor } from '../editor';

const VERB: Record<BulkMode, string> = {
  comment: 'commented',
  uncomment: 'uncommented',
  delete: 'deleted',
};

/**
 * Applies a bulk operation to the turbo logs in the active file.
 *
 * Only the matched lines are edited, so undo stays one step and the cursor, selection and folding survive.
 * Hand-written logs carry no marker and are never matched.
 */
export async function runBulkCommand(mode: BulkMode): Promise<void> {
  const config = readTurboConfig(vscode.window.activeTextEditor?.document);
  const editor = requireDartEditor(config);
  if (!editor) {
    return;
  }

  const document = editor.document;
  const edits = planBulkEdits(document.getText().split('\n'), config, mode);

  if (edits.length === 0) {
    void vscode.window.showInformationMessage(
      'turbo-flutter-log: no log messages from this extension in the current file.',
    );
    return;
  }

  await editor.edit((builder) => {
    for (const edit of edits) {
      const line = document.lineAt(edit.line);
      if (edit.text === undefined) {
        builder.delete(line.rangeIncludingLineBreak);
      } else {
        builder.replace(line.range, edit.text);
      }
    }
  });

  void vscode.window.showInformationMessage(
    `turbo-flutter-log: ${VERB[mode]} ${edits.length} log message${edits.length === 1 ? '' : 's'}.`,
  );
}
