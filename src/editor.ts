import * as vscode from 'vscode';

import {
  hasUsableMarker,
  resolveConfig,
  type RawConfig,
  type TurboConfig,
} from './config';
import { findEnclosingChain, type SymbolNode } from './symbols';
import { chooseExpression, chooseStatementText } from './target';

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
 * Resolves what to log and where to put it.
 *
 * A non-empty selection is taken at face value — the user has already said what they mean.
 * Otherwise the analysis server's nested ranges around the cursor decide, via {@link chooseExpression}.
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

  const expression = selection.isEmpty
    ? chooseExpression(chain)
    : document.getText(selection).trim();

  if (expression.length === 0 || expression.includes('\n')) {
    return undefined;
  }

  // The statement may start on an earlier line than the cursor, so its own
  // range decides where the log goes — not an offset from the cursor.
  const statement = chooseStatementText(chain);
  const statementIndex =
    statement === undefined ? -1 : chain.indexOf(statement);
  const insertAfterLine =
    statementIndex === -1
      ? position.line
      : nodes[statementIndex].range.end.line;

  return { expression, insertAfterLine };
}
