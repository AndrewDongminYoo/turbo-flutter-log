import * as vscode from 'vscode';

import { runBulkCommand } from './commands/bulk';
import { displayLogMessage } from './commands/insert';

/**
 * Registration only.
 * Every command body lives under `src/commands/`, and everything with a decision in it lives in a `vscode`-free module beside it.
 */
export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'turbo-flutter-log.displayLogMessage',
      displayLogMessage,
    ),
    vscode.commands.registerCommand(
      'turbo-flutter-log.commentAllLogMessages',
      () => runBulkCommand('comment'),
    ),
    vscode.commands.registerCommand(
      'turbo-flutter-log.uncommentAllLogMessages',
      () => runBulkCommand('uncomment'),
    ),
    vscode.commands.registerCommand(
      'turbo-flutter-log.deleteAllLogMessages',
      () => runBulkCommand('delete'),
    ),
  );
}

export function deactivate(): void {}
