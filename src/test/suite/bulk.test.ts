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

/** `undo` is dispatched to the workbench and lands on the document asynchronously. */
async function nextChange(
  document: vscode.TextDocument,
  timeoutMs = 2000,
): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(finish, timeoutMs);
    const subscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document === document) {
        finish();
      }
    });
    function finish(): void {
      clearTimeout(timer);
      subscription.dispose();
      resolve();
    }
  });
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

  test('a whole command is a single undo step', async () => {
    const document = await openDart(SOURCE);

    await vscode.commands.executeCommand(
      'turbo-flutter-log.deleteAllLogMessages',
    );
    assert.notStrictEqual(document.getText(), SOURCE);

    const settled = nextChange(document);
    await vscode.commands.executeCommand('undo');
    await settled;

    assert.strictEqual(document.getText(), SOURCE);
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
