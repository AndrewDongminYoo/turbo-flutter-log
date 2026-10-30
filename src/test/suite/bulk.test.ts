import * as assert from 'assert';

import * as vscode from 'vscode';

/**
 * The bulk commands need no language server, so unlike insertion they can be
 * driven end to end here — through the real `editor.edit()` path, which is where
 * the previous whole-document `replace` lived.
 */

const TURBO = "  print('🎯 · [DEBUG] · a.dart:3 · A.b · user: $user');";
const HAND_WRITTEN = "  print('starting up');";

const SOURCE = ['void main() {', HAND_WRITTEN, TURBO, '}', ''].join('\n');

/** Observe the model undo event, not only the command promise. */
async function undo(document: vscode.TextDocument): Promise<void> {
  let subscription: vscode.Disposable | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        subscription = vscode.workspace.onDidChangeTextDocument((event) => {
          if (
            event.document === document &&
            event.reason === vscode.TextDocumentChangeReason.Undo
          ) {
            resolve();
          }
        });
        timer = setTimeout(
          () => reject(new Error('No document undo event received')),
          2000,
        );
      }),
      vscode.commands.executeCommand('undo'),
    ]);
  } finally {
    clearTimeout(timer);
    subscription?.dispose();
  }
}

async function openDart(content: string): Promise<vscode.TextDocument> {
  const document = await vscode.workspace.openTextDocument({
    language: 'dart',
    content,
  });
  await vscode.window.showTextDocument(document);
  return document;
}

suite('bulk commands', () => {
  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('comment then uncomment restores the document exactly', async () => {
    const document = await openDart(SOURCE);

    await vscode.commands.executeCommand(
      'turbo-flutter-log.commentAllLogMessages',
    );
    assert.notStrictEqual(
      document.getText(),
      SOURCE,
      'comment changed nothing',
    );
    assert.ok(document.getText().includes("// print('🎯"), document.getText());

    await vscode.commands.executeCommand(
      'turbo-flutter-log.uncommentAllLogMessages',
    );
    assert.strictEqual(document.getText(), SOURCE);
  });

  test('delete removes the marked log and leaves the hand-written one', async () => {
    const document = await openDart(SOURCE);

    await vscode.commands.executeCommand(
      'turbo-flutter-log.deleteAllLogMessages',
    );

    const text = document.getText();
    assert.ok(!text.includes('🎯'), text);
    assert.ok(text.includes(HAND_WRITTEN.trim()), text);
    assert.strictEqual(text.split('\n').length, SOURCE.split('\n').length - 1);
  });

  test('a whole command is a single undo step', async function () {
    this.timeout(30000);
    const source = SOURCE.replace(TURBO, `${TURBO}\n${TURBO}`);
    const document = await openDart(source);

    // Native window activation can wait for workbench startup on macOS.
    await vscode.commands.executeCommand('workbench.action.focusWindow');
    const focusDeadline = Date.now() + 2000;
    while (!vscode.window.state.focused && Date.now() < focusDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(
      vscode.window.state.focused,
      'Undo requires a focused host window',
    );
    await vscode.commands.executeCommand(
      'workbench.action.focusActiveEditorGroup',
    );

    await vscode.commands.executeCommand(
      'turbo-flutter-log.deleteAllLogMessages',
    );
    assert.ok(!document.getText().includes('🎯'), document.getText());
    assert.ok(document.getText().includes(HAND_WRITTEN.trim()));

    await undo(document);
    assert.strictEqual(document.getText(), source);
  });

  test('refuses to touch a file that is not Dart', async () => {
    const document = await vscode.workspace.openTextDocument({
      language: 'typescript',
      content: SOURCE,
    });
    await vscode.window.showTextDocument(document);

    await vscode.commands.executeCommand(
      'turbo-flutter-log.deleteAllLogMessages',
    );

    assert.strictEqual(document.getText(), SOURCE);
  });
});
