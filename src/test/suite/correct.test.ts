import * as assert from 'assert';

import * as vscode from 'vscode';

/**
 * Correct needs no language server for the parts under test here: the file name
 * and line number come from the document itself. Only the enclosing symbol needs
 * the analyzer, and its absence simply leaves that segment out.
 */

const stale = "  print('🎯 · [DEBUG] · wrong.dart:99 · user: $user');";

const SOURCE = ['void main() {', "  final user = 'u';", stale, '}', ''].join(
  '\n',
);

async function openDart(content: string): Promise<vscode.TextDocument> {
  const document = await vscode.workspace.openTextDocument({
    language: 'dart',
    content,
  });
  await vscode.window.showTextDocument(document);
  return document;
}

suite('correctAllLogMessages', () => {
  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('updates a stale line number and keeps the logged expression', async () => {
    const document = await openDart(SOURCE);

    await vscode.commands.executeCommand(
      'turbo-flutter-log.correctAllLogMessages',
    );

    const corrected = document.lineAt(2).text;
    assert.ok(!corrected.includes(':99'), corrected);
    assert.ok(corrected.includes('user: $user'), corrected);
    assert.ok(corrected.includes('[DEBUG]'), corrected);
  });

  test('leaves hand-written logs alone', async () => {
    const document = await openDart(
      ['void main() {', "  print('untouched');", stale, '}', ''].join('\n'),
    );

    await vscode.commands.executeCommand(
      'turbo-flutter-log.correctAllLogMessages',
    );

    assert.strictEqual(document.lineAt(1).text, "  print('untouched');");
  });

  test('is idempotent', async () => {
    const document = await openDart(SOURCE);

    await vscode.commands.executeCommand(
      'turbo-flutter-log.correctAllLogMessages',
    );
    const once = document.getText();

    await vscode.commands.executeCommand(
      'turbo-flutter-log.correctAllLogMessages',
    );
    assert.strictEqual(document.getText(), once);
  });

  test('corrects a commented log without uncommenting it', async () => {
    const document = await openDart(
      [
        'void main() {',
        "  final user = 'u';",
        `  //${stale.trim()}`,
        '}',
        '',
      ].join('\n'),
    );

    await vscode.commands.executeCommand(
      'turbo-flutter-log.correctAllLogMessages',
    );

    const corrected = document.lineAt(2).text;
    assert.ok(corrected.trimStart().startsWith('//'), corrected);
    assert.ok(!corrected.includes(':99'), corrected);
  });

  test('keeps a trailing comment on the corrected line', async () => {
    // Regression: the comment matched but fell outside every capture group, so
    // rebuilding the line deleted it without a word.
    const document = await openDart(
      [
        'void main() {',
        "  final user = 'u';",
        `${stale} // why twice`,
        '}',
        '',
      ].join('\n'),
    );

    await vscode.commands.executeCommand(
      'turbo-flutter-log.correctAllLogMessages',
    );

    const corrected = document.lineAt(2).text;
    assert.ok(!corrected.includes(':99'), corrected);
    assert.ok(corrected.endsWith(' // why twice'), corrected);
  });

  test('reads the line from the code, not from the log above it', async () => {
    // Regression: matching the expression as a bare substring let the preceding
    // log win, so the second of two stacked logs reported the first one's line.
    const document = await openDart(
      ['void main() {', "  final user = 'u';", stale, stale, '}', ''].join(
        '\n',
      ),
    );

    await vscode.commands.executeCommand(
      'turbo-flutter-log.correctAllLogMessages',
    );

    for (const line of [2, 3]) {
      assert.ok(document.lineAt(line).text.includes(':2 '), `line ${line}`);
    }
  });

  test('refuses to touch a file that is not Dart', async () => {
    const document = await vscode.workspace.openTextDocument({
      language: 'typescript',
      content: SOURCE,
    });
    await vscode.window.showTextDocument(document);

    await vscode.commands.executeCommand(
      'turbo-flutter-log.correctAllLogMessages',
    );

    assert.strictEqual(document.getText(), SOURCE);
  });
});
