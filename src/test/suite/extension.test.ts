import * as assert from 'assert';

import * as vscode from 'vscode';

// Resolved by package name rather than `publisher.name`, so adding a
// `publisher` field before release does not break this test.
const EXTENSION_NAME = 'turbo-flutter-log';

suite('extension', () => {
  test('registers every command it contributes', async () => {
    const extension = vscode.extensions.all.find(
      (candidate) => candidate.packageJSON.name === EXTENSION_NAME,
    );
    assert.ok(extension, `extension ${EXTENSION_NAME} not found`);
    await extension.activate();

    const contributed: string[] =
      extension.packageJSON.contributes.commands.map(
        (command: { command: string }) => command.command,
      );
    assert.ok(contributed.length > 0, 'no commands contributed');

    const registered = await vscode.commands.getCommands(true);
    for (const command of contributed) {
      assert.ok(registered.includes(command), `${command} is not registered`);
    }
  });
});
