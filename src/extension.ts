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

        // 현재 커서 위치 또는 선택된 텍스트
        const selectedText = document.getText(selection);
        const lineNumber = selection.active.line;
        const lineText = document.lineAt(lineNumber).text;

        // 기본 로그 포맷 정의
        const logStatement = generateLogStatement(selectedText || lineText);

        // 현재 커서 아래에 로그 문 삽입
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
        const updatedText = text.replace(
          /print\(.*\);/g,
          (match) => `// ${match}`,
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
        const updatedText = text.replace(/\/\/\s*print\(.*\);/g, (match) =>
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
        const updatedText = text.replace(/print\(.*\);/g, '');
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

// This method is called when your extension is deactivated
export function deactivate() {}

function generateLogStatement(selectedText: string): string {
  const timestamp = new Date().toISOString();
  return `print("[DEBUG - ${timestamp}] ${selectedText}: ", ${selectedText});\n`;
}
