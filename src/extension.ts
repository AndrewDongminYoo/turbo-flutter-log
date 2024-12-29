// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log(
    'Congratulations, your extension "turbo-flutter-log" is now active!',
  );

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'turbo-flutter-log.displayLogMessage',
      () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showErrorMessage('No active editor found.');
          return;
        }
        const document = editor.document;
        const selection = editor.selection;

        // Current cursor position or selected text
        const selectedText = document.getText(selection);
        const lineNumber = selection.active.line;
        const lineText = document.lineAt(lineNumber).text;

        // Define the default log format
        const logStatement = generateLogStatement(selectedText || lineText);

        // Insert a log statement under the current cursor
        editor.edit((editBuilder) => {
          const position = new vscode.Position(lineNumber + 1, 0); // 다음 줄
          editBuilder.insert(position, logStatement);
        });
      },
    ),
  );

  // Comment all log messages
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'turbo-flutter-log.commentAllLogMessages',
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showErrorMessage('No active editor found.');
          return;
        }

        const document = editor.document;
        const text = document.getText();

        // Get `logFunction` from settings
        const config = vscode.workspace.getConfiguration('turbo-flutter-log');
        const logFunction = config.get<string>('logFunction', 'print');
        const regex = new RegExp(
          `${logFunction}\$begin:math:text$.*\\$end:math:text$;`,
          'g',
        );

        const updatedText = text.replace(regex, (match) => `// ${match}`);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
          document.uri,
          new vscode.Range(0, 0, document.lineCount, 0),
          updatedText,
        );
        await vscode.workspace.applyEdit(edit);
      },
    ),
  );

  // Uncomment all log messages
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'turbo-flutter-log.uncommentAllLogMessages',
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showErrorMessage('No active editor found.');
          return;
        }

        const document = editor.document;
        const text = document.getText();

        // Get `logFunction` from settings
        const config = vscode.workspace.getConfiguration('turbo-flutter-log');
        const logFunction = config.get<string>('logFunction', 'print');
        const regex = new RegExp(
          `\/\/\\s*${logFunction}\$begin:math:text$.*\\$end:math:text$;`,
          'g',
        );

        // Uncomment by removing the '//' part
        const updatedText = text.replace(regex, (match) =>
          match.replace('// ', ''),
        );

        const edit = new vscode.WorkspaceEdit();
        edit.replace(
          document.uri,
          new vscode.Range(0, 0, document.lineCount, 0),
          updatedText,
        );
        await vscode.workspace.applyEdit(edit);
      },
    ),
  );

  // Delete all log messages
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'turbo-flutter-log.deleteAllLogMessages',
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showErrorMessage('No active editor found.');
          return;
        }

        const document = editor.document;
        const text = document.getText();

        // Get `logFunction` from settings
        const config = vscode.workspace.getConfiguration('turbo-flutter-log');
        const logFunction = config.get<string>('logFunction', 'print');
        const regex = new RegExp(
          `${logFunction}\$begin:math:text$.*\\$end:math:text$;`,
          'g',
        );

        const updatedText = text.replace(regex, '');
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
          document.uri,
          new vscode.Range(0, 0, document.lineCount, 0),
          updatedText,
        );
        await vscode.workspace.applyEdit(edit);
      },
    ),
  );
}

export function deactivate() {}

/**
 * Functions to construct log statements with set values (`logFunction`, `logLevel`)
 */
function generateLogStatement(selectedText: string): string {
  const config = vscode.workspace.getConfiguration('turbo-flutter-log');
  const logFunction = config.get<string>('logFunction', 'print');
  const logLevel = config.get<string>('logLevel', 'debug');
  const timestamp = new Date().toISOString();

  return `${logFunction}("[${logLevel.toUpperCase()} - ${timestamp}] ${selectedText}: ", ${selectedText});\n`;
}
