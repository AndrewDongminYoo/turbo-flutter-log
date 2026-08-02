import { TextDecoder } from 'node:util';

import * as vscode from 'vscode';

import {
  hasUsableMarker,
  resolveConfig,
  type RawConfig,
  type TurboConfig,
} from './config';
import { classifyHover } from './hover';
import { findEnclosingChain, type SymbolNode } from './symbols';
import { DEFAULT_PAGE_WIDTH, parsePageWidth } from './width';
import {
  assignmentIndex,
  chooseExpression,
  chooseStatementText,
  closureBodyOpening,
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
  /**
   * Zero-based line whose indentation the log copies.
   *
   * Not the same as {@link insertAfterLine}: a statement spanning several lines ends on a
   * continuation line indented further than its own first line, and copying that would indent the
   * log too deeply.
   */
  indentFromLine: number;
  /** True when the log goes at the top of a block, so it needs one level more than its opening line. */
  insideBlock: boolean;
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

/**
 * Flattens a hover response into markdown, or `undefined` when nothing answered.
 *
 * `undefined` and empty are not the same thing to the caller: the analyzer returns no hover for a
 * keyword, which is itself an answer, while a missing provider means fall back.
 */
async function readHover(
  document: vscode.TextDocument,
  position: vscode.Position,
): Promise<string | undefined> {
  const hovers = await vscode.commands.executeCommand<
    vscode.Hover[] | undefined
  >('vscode.executeHoverProvider', document.uri, position);

  if (hovers === undefined) {
    return undefined;
  }

  return hovers
    .flatMap((hover) => hover.contents)
    .map((content) => (typeof content === 'string' ? content : content.value))
    .join('\n');
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
async function fromCursor(
  document: vscode.TextDocument,
  position: vscode.Position,
  chain: readonly string[],
  statement: string | undefined,
  preferWord: boolean,
): Promise<string> {
  const line = document.lineAt(position.line).text;
  const wordRange = document.getWordRangeAtPosition(position);
  const word = wordRange ? document.getText(wordRange) : '';
  const assignment = assignmentIndex(line);

  // Left of a top-level assignment is the declaration's prefix — modifiers, a
  // type, generic arguments — so the variable being assigned is what was meant,
  // whatever the cursor happens to rest on.
  const declared =
    assignment >= 0 && position.character <= assignment
      ? declaredNameIn(line)
      : undefined;

  // Ask the analyzer what this is, rather than inferring it from text. An empty
  // chain means no language server answered at all, so there is nothing to ask.
  const kind =
    chain.length === 0
      ? 'unknown'
      : classifyHover(await readHover(document, position), word);

  if (kind !== 'value' && kind !== 'unknown') {
    // A keyword, a type, or a named argument's name. The declared variable is
    // the only thing nearby that is a value; without one, the honest answer is
    // nothing.
    return declared ?? '';
  }

  // The analyzer confirmed this word is a value, and the user pointed at it.
  // Widening past an explicit selection would log something they did not ask
  // for — `state` becoming `state.needsReload`, or `prefs` becoming a call.
  if (kind === 'value' && preferWord) {
    return word;
  }

  // Only when the word itself is not a known value does the declaration's
  // target apply; otherwise `state` in `state.needsReload = false` would be
  // replaced by the assignment target.
  if (kind !== 'value' && declared !== undefined) {
    return declared;
  }

  const fromChain = chooseExpression(chain);
  if (fromChain) {
    return fromChain;
  }

  if (kind === 'value') {
    return word;
  }

  // No analyzer answer to go on. The text-based rules below are the fallback
  // for the window while the server is starting, or when Dart tooling is absent.

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
  let insertAfterLine =
    statementIndex === -1
      ? position.line
      : nodes[statementIndex].range.end.line;
  // A statement spanning several lines ends on a continuation line indented
  // further than its own first line; the log belongs at the statement's indent.
  let indentFromLine =
    statementIndex === -1
      ? position.line
      : nodes[statementIndex].range.start.line;
  // Falling back to the cursor's line lands inside a block whenever that line
  // opens one, and then the log needs the body's indent rather than the header's.
  let insideBlock =
    statementIndex === -1 &&
    document.lineAt(position.line).text.trimEnd().endsWith('{');

  // When the cursor sits in a closure's parameter list, the statement found
  // above is the enclosing call, outside the closure — and a log for a parameter
  // placed there would name something out of scope. The closure's body is where
  // it belongs.
  for (let index = 1; index < Math.max(statementIndex, 2); index += 1) {
    const opening = closureBodyOpening(chain[index], chain[index + 1]);
    if (opening === undefined) {
      continue;
    }

    const start = nodes[index + 1].range.start;
    insertAfterLine = start.line + opening.lineOffset;
    indentFromLine = insertAfterLine;
    insideBlock = true;
    break;
  }

  // A selection says what the user meant — but only if it is actually an
  // expression. Selecting `final` out of `finalObj` is a partial token.
  //
  // A selection that is a single identifier goes through the cursor path even
  // though it looks valid, because only the analyzer can tell `dismissible` the
  // named argument from `dismissible` the variable. A compound selection such as
  // `a + b` has no single symbol to ask about, so it is taken at face value.
  const selected = document.getText(selection).trim();
  const isSingleIdentifier = /^[A-Za-z_][A-Za-z0-9_]*$/.test(selected);
  const expression =
    !selection.isEmpty && !isSingleIdentifier && isLoggableExpression(selected)
      ? selected
      : await fromCursor(
          document,
          position,
          chain,
          statement,
          !selection.isEmpty && isSingleIdentifier,
        );

  if (expression.length === 0 || expression.includes('\n')) {
    return undefined;
  }

  return {
    expression,
    expressionLine: selection.isEmpty ? position.line : selection.start.line,
    insertAfterLine,
    indentFromLine,
    insideBlock,
  };
}
