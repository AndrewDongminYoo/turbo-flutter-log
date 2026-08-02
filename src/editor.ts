import { TextDecoder } from 'node:util';

import * as vscode from 'vscode';

import {
  hasUsableMarker,
  resolveConfig,
  type RawConfig,
  type TurboConfig,
} from './config';
import { findEnclosingChain, type SymbolNode } from './symbols';
import { DEFAULT_PAGE_WIDTH, parsePageWidth } from './width';
import {
  assignmentIndex,
  chooseExpression,
  chooseStatementText,
  declaredNameIn,
  isDeclarationModifier,
  isLoggableExpression,
  isLoggableIdentifier,
} from './target';

const SECTION = 'turbo-flutter-log';

const KEYS: readonly (keyof TurboConfig)[] = [
  'logFunction',
  'logLevel',
  'marker',
  'delimiter',
  'quote',
  'includeFileName',
  'includeLineNumber',
  'includeEnclosingClass',
  'includeEnclosingFunction',
  'insertEmptyLineBefore',
  'insertEmptyLineAfter',
  'developerLogAlias',
];

/**
 * Reads the settings block without applying VS Code's own defaults, so `resolveConfig` can tell an unset value from an explicitly emptied one.
 */
export function readTurboConfig(
  scope?: vscode.ConfigurationScope,
): TurboConfig {
  const section = vscode.workspace.getConfiguration(SECTION, scope);
  const raw: RawConfig = {};
  for (const key of KEYS) {
    raw[key] = section.get(key);
  }
  return resolveConfig(raw);
}

/**
 * Resolves the editor a command may act on, or reports why it may not.
 *
 * Both refusals are the point rather than defensive noise: without the language check the commands rewrite any open file, and without the marker check they would match every log in it.
 */
export function requireDartEditor(
  config: TurboConfig,
): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showErrorMessage('turbo-flutter-log: no active editor.');
    return undefined;
  }
  if (editor.document.languageId !== 'dart') {
    void vscode.window.showErrorMessage(
      'turbo-flutter-log: this command only runs on Dart files.',
    );
    return undefined;
  }
  if (!hasUsableMarker(config)) {
    void vscode.window.showErrorMessage(
      `turbo-flutter-log: the "${SECTION}.marker" setting is empty. An empty marker would match every log in the file, so every command refuses to run.`,
    );
    return undefined;
  }
  return editor;
}

/**
 * Thin adapters over VS Code's built-in provider commands, which proxy to whatever language server is active — here, the one the Dart extension already runs.
 *
 * Everything with a decision in it lives in `symbols.ts` and `target.ts`, which are `vscode`-free and unit-tested against output captured from a real `dart language-server`.
 * This file is deliberately the part with no logic worth testing.
 */

const CLASS_KINDS = new Set<vscode.SymbolKind>([
  vscode.SymbolKind.Class,
  vscode.SymbolKind.Enum,
  vscode.SymbolKind.Struct,
  vscode.SymbolKind.Interface,
]);

const FUNCTION_KINDS = new Set<vscode.SymbolKind>([
  vscode.SymbolKind.Method,
  vscode.SymbolKind.Function,
  vscode.SymbolKind.Constructor,
]);

export interface EnclosingSymbols {
  enclosingClass?: string;
  enclosingFunction?: string;
}

export interface ResolvedTarget {
  /** The Dart expression to log. */
  expression: string;
  /**
   * Zero-based line where the logged expression lives.
   *
   * This is what the message reports, not the line the log itself lands on: the
   * useful fact is where the value is read, and the log's own position shifts
   * with every later edit anyway.
   */
  expressionLine: number;
  /** Zero-based line the log statement goes after. */
  insertAfterLine: number;
}

let warnedAboutProvider = false;

/**
 * Shown at most once per session: a missing symbol provider costs the class and function segments but nothing else, so nagging on every insertion would be worse than the gap.
 */
function warnProviderUnavailable(): void {
  if (warnedAboutProvider) {
    return;
  }
  warnedAboutProvider = true;
  void vscode.window.showWarningMessage(
    'turbo-flutter-log: no Dart symbol provider answered, so logs will omit the class and function name. Is the Dart extension installed and finished starting?',
  );
}

/** Exposed for tests, which need a fresh session per case. */
export function resetProviderWarning(): void {
  warnedAboutProvider = false;
}

/**
 * Finds the page width `dart format` will wrap at, by walking up from the file to the nearest
 * `analysis_options.yaml` that declares one.
 *
 * The walk stops at the workspace folder, so a stray file outside the project cannot set the width.
 * Falling back to `dart format`'s own default errs toward shorter logs, which is the safe direction:
 * a log that overflows gets split by the formatter and the bulk commands can no longer find it.
 */
export async function readPageWidth(
  document: vscode.TextDocument,
): Promise<number> {
  const root = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.path;
  let directory = vscode.Uri.joinPath(document.uri, '..');

  for (let depth = 0; depth < 32; depth += 1) {
    try {
      const bytes = await vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(directory, 'analysis_options.yaml'),
      );
      const width = parsePageWidth(new TextDecoder().decode(bytes));
      if (width !== undefined) {
        return width;
      }
    } catch {
      // No analysis_options.yaml here; keep walking.
    }

    const parent = vscode.Uri.joinPath(directory, '..');
    if (parent.path === directory.path) {
      break;
    }
    if (root !== undefined && !parent.path.startsWith(root)) {
      break;
    }
    directory = parent;
  }

  return DEFAULT_PAGE_WIDTH;
}

export async function resolveEnclosingSymbols(
  document: vscode.TextDocument,
  line: number,
): Promise<EnclosingSymbols> {
  const symbols = await vscode.commands.executeCommand<
    vscode.DocumentSymbol[] | undefined
  >('vscode.executeDocumentSymbolProvider', document.uri);

  if (!symbols || symbols.length === 0) {
    warnProviderUnavailable();
    return {};
  }

  const chain = findEnclosingChain(symbols as SymbolNode[], line);

  return {
    enclosingClass: chain.find((symbol) => CLASS_KINDS.has(symbol.kind))?.name,
    enclosingFunction: [...chain]
      .reverse()
      .find((symbol) => FUNCTION_KINDS.has(symbol.kind))?.name,
  };
}

/**
 * Picks what to log for a cursor with no selection, in order of preference.
 *
 * 1. The variable being assigned, when the cursor is left of the assignment. Everything there is
 *    prefix — `final`, `Sheet?`, `Map<String, dynamic>` — and none of it is a value.
 * 2. The analysis server's ranges, which give the whole member chain or index.
 * 3. The identifier under the cursor, when the innermost range is a declarator or a multi-line statement.
 *
 * When none of those produce a value the answer is nothing, and the command says so rather than
 * emitting a guess: `$final` and `${dismissible: false,}` do not compile.
 */
function fromCursor(
  document: vscode.TextDocument,
  position: vscode.Position,
  chain: readonly string[],
  statement: string | undefined,
): string {
  const line = document.lineAt(position.line).text;

  // Left of the assignment is the declaration's prefix — modifiers, a type,
  // generic arguments — and none of it is a value. The variable being assigned
  // is what the user meant. This runs before the chain because the chain would
  // happily hand back the type name.
  const assignment = assignmentIndex(line);
  if (assignment >= 0 && position.character <= assignment) {
    const declared = declaredNameIn(line);
    if (declared) {
      return declared;
    }
  }

  const fromChain = chooseExpression(chain);
  if (fromChain) {
    return fromChain;
  }

  const wordRange = document.getWordRangeAtPosition(position);
  const word = wordRange ? document.getText(wordRange) : '';

  // A word followed by a colon is the *name* in a name/value pair — a named
  // argument, a map key, a label — not a value that can be interpolated.
  const isName =
    wordRange !== undefined &&
    line.slice(wordRange.end.character).trimStart().startsWith(':');

  if (isLoggableIdentifier(word) && !isName) {
    return word;
  }

  if (isDeclarationModifier(word)) {
    return declaredNameIn(statement ?? line) ?? '';
  }

  // Nothing here is a value. Refusing is the right answer: emitting a guess
  // produces code that does not compile.
  return '';
}

/**
 * Resolves what to log and where to put it.
 *
 * A non-empty selection is taken at face value — the user has already said what they mean.
 * Otherwise {@link fromCursor} decides, and returns nothing when the cursor is not on a value.
 */
export async function resolveTarget(
  document: vscode.TextDocument,
  selection: vscode.Selection,
): Promise<ResolvedTarget | undefined> {
  const position = selection.active;

  const ranges = await vscode.commands.executeCommand<
    vscode.SelectionRange[] | undefined
  >('vscode.executeSelectionRangeProvider', document.uri, [position]);

  const nodes: vscode.SelectionRange[] = [];
  for (
    let node = ranges?.[0];
    node !== undefined && nodes.length < 16;
    node = node.parent
  ) {
    nodes.push(node);
  }
  const chain = nodes.map((node) => document.getText(node.range));

  // The statement may start on an earlier line than the cursor, so its own
  // range decides where the log goes — not an offset from the cursor.
  const statement = chooseStatementText(chain);
  const statementIndex =
    statement === undefined ? -1 : chain.indexOf(statement);
  const insertAfterLine =
    statementIndex === -1
      ? position.line
      : nodes[statementIndex].range.end.line;

  // A selection says what the user meant — but only if it is actually an
  // expression. Selecting `final` out of `finalObj` is a partial token, and
  // falling through to the cursor logic recovers `finalObj`.
  const selected = document.getText(selection).trim();
  const expression =
    !selection.isEmpty && isLoggableExpression(selected)
      ? selected
      : fromCursor(document, position, chain, statement);

  if (expression.length === 0 || expression.includes('\n')) {
    return undefined;
  }

  return {
    expression,
    expressionLine: selection.isEmpty ? position.line : selection.start.line,
    insertAfterLine,
  };
}
